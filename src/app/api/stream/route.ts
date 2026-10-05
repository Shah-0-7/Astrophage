/**
 * ============================================================
 * /api/stream – Unified SSE Telemetry Stream
 * ============================================================
 * Streams unified geospatial events from all Phase 2 sources
 * to connected frontend clients via Server-Sent Events.
 *
 * Architecture:
 *   1. Client connects → initial data burst sent immediately
 *   2. Redis subscriber forwards any Pub/Sub messages in real-time
 *   3. If Redis unavailable → 60-second polling fallback per source
 *   4. Heartbeat every 30 s to keep the connection alive
 *
 * SSE Frame format:
 *   data: <JSON StreamPayload>\n\n
 * ============================================================
 */

import { NextRequest } from 'next/server';
import { subscribe, STREAM_CHANNEL } from '@/lib/redis';
import type { StreamPayload, UnifiedFeature, SeismicProperties } from '@/lib/types';
import { tagSeismicEvent, upsertSeismicEvent } from '@/lib/postgis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USGS_BASE   = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const GVP_RSS     = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';
const PTWC_RSS    = 'https://www.tsunami.gov/events/rss.xml';
const NSIDC_BASE  = 'https://nsidc.org/api/seaice/extent';

// ── Fetch helpers ────────────────────────────────────────────

async function fetchSeismic(): Promise<UnifiedFeature[]> {
  const now  = new Date();
  const past = new Date(now);
  past.setDate(past.getDate() - 7);

  const params = new URLSearchParams({
    format:       'geojson',
    minmagnitude: '3.0',
    limit:        '300',
    orderby:      'time',
    starttime:    past.toISOString(),
    endtime:      now.toISOString(),
  });

  const res = await fetch(`${USGS_BASE}?${params}`);
  if (!res.ok) return [];
  const data = await res.json();

  const features: UnifiedFeature[] = await Promise.all(
    (data.features ?? []).map(async (f: any): Promise<UnifiedFeature> => {
      const p = f.properties;
      const [lng, lat, depth] = f.geometry.coordinates;

      // Persist to PostGIS and tag (no-op if DB unavailable)
      await upsertSeismicEvent({
        id: f.id, magnitude: p.mag, place: p.place,
        depth_km: depth, tsunami: p.tsunami, sig: p.sig,
        event_time: new Date(p.time).toISOString(), url: p.url,
        lng, lat,
      });
      const tag = await tagSeismicEvent(f.id);

      const props: SeismicProperties = {
        magnitude:   p.mag,
        place:       p.place ?? '',
        depth_km:    depth,
        tsunami:     p.tsunami,
        sig:         p.sig,
        event_time:  new Date(p.time).toISOString(),
        url:         p.url ?? '',
        fault_name:  tag?.faultName,
        distance_m:  tag?.distanceM,
        subtype:     tag?.subtype,
      };

      return {
        id:       f.id,
        source:   'seismic',
        subtype:  tag?.subtype,
        geometry: f.geometry,
        properties: props,
      };
    }),
  );

  return features;
}

async function fetchVolcanism(): Promise<UnifiedFeature[]> {
  try {
    const res = await fetch(GVP_RSS, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const xml = await res.text();

    // Parse RSS items from the Smithsonian GVP feed
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items.slice(0, 30).map((match, i) => {
      const item   = match[1];
      const title  = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? [])[1] ?? '';
      const desc   = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ?? [])[1] ?? '';
      const latStr = (item.match(/<geo:lat>(.*?)<\/geo:lat>/) ?? [])[1];
      const lngStr = (item.match(/<geo:long>(.*?)<\/geo:long>/) ?? [])[1];

      const lat = parseFloat(latStr ?? '0');
      const lng = parseFloat(lngStr ?? '0');

      // Extract aviation colour from title/description (RED/ORANGE/YELLOW/GREEN)
      const colorMatch = (title + desc).match(/\b(RED|ORANGE|YELLOW|GREEN)\b/i);
      const aviationColor = (colorMatch?.[1]?.toUpperCase() ?? 'YELLOW') as
        'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

      return {
        id:     `gvp-${i}-${Date.now()}`,
        source: 'volcanism' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: {
          volcano_id:     i,
          name:           title.split('(')[0].trim(),
          country:        '',
          aviation_color: aviationColor,
          alert_level:    aviationColor,
          last_eruption:  '',
          activity:       desc.replace(/<[^>]+>/g, '').slice(0, 200),
        },
      };
    });
  } catch {
    return [];
  }
}

async function fetchTsunami(): Promise<UnifiedFeature[]> {
  try {
    const res = await fetch(PTWC_RSS, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items.slice(0, 10).map((match, i) => {
      const item    = match[1];
      const title   = (item.match(/<title>(.*?)<\/title>/) ?? [])[1] ?? '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) ?? [])[1] ?? new Date().toISOString();
      const link    = (item.match(/<link>(.*?)<\/link>/) ?? [])[1] ?? '';

      const severity: 'WATCH' | 'WARNING' | 'ADVISORY' | 'INFO' =
        title.toLowerCase().includes('warning') ? 'WARNING'
        : title.toLowerCase().includes('watch')   ? 'WATCH'
        : title.toLowerCase().includes('advisory') ? 'ADVISORY'
        : 'INFO';

      return {
        id:     `ptwc-${i}-${Date.now()}`,
        source: 'tsunami' as const,
        geometry: { type: 'Point' as const, coordinates: [0, 0] }, // PTWC doesn't geo-tag RSS
        properties: {
          warning_id: `ptwc-${i}`,
          title,
          severity,
          issued_at: new Date(pubDate).toISOString(),
        },
      };
    });
  } catch {
    return [];
  }
}

// ── SSE helper ───────────────────────────────────────────────

function encodeSSE(payload: StreamPayload): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Route handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { signal } = request;
  const timers: ReturnType<typeof setInterval>[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: StreamPayload) => {
        try { controller.enqueue(encodeSSE(payload)); } catch { /* client gone */ }
      };

      // ── 1. Initial data burst ───────────────────────────────
      const [seismicFeatures, volcanismFeatures, tsunamiFeatures] = await Promise.all([
        fetchSeismic(),
        fetchVolcanism(),
        fetchTsunami(),
      ]);

      if (seismicFeatures.length)
        send({ type: 'seismic', ts: Date.now(), features: seismicFeatures });
      if (volcanismFeatures.length)
        send({ type: 'volcanism', ts: Date.now(), features: volcanismFeatures });
      if (tsunamiFeatures.length)
        send({ type: 'tsunami', ts: Date.now(), features: tsunamiFeatures });

      // ── 2. Redis Pub/Sub listener (if available) ───────────
      const unsubscribe = subscribe((raw) => {
        try {
          const payload = JSON.parse(raw) as StreamPayload;
          send(payload);
        } catch { /* malformed message */ }
      });

      // ── 3. Polling fallback (60 s cadence if no Redis) ─────
      timers.push(setInterval(async () => {
        const features = await fetchSeismic();
        if (features.length) send({ type: 'seismic', ts: Date.now(), features });
      }, 60_000));

      timers.push(setInterval(async () => {
        const features = await fetchVolcanism();
        if (features.length) send({ type: 'volcanism', ts: Date.now(), features });
      }, 3_600_000)); // hourly

      timers.push(setInterval(async () => {
        const features = await fetchTsunami();
        if (features.length) send({ type: 'tsunami', ts: Date.now(), features });
      }, 300_000)); // every 5 min

      // ── 4. Heartbeat ────────────────────────────────────────
      timers.push(setInterval(() => {
        send({ type: 'heartbeat', ts: Date.now(), features: [] });
      }, 30_000));

      // ── 5. Cleanup on client disconnect ─────────────────────
      signal.addEventListener('abort', () => {
        timers.forEach(clearInterval);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
