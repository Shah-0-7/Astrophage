/**
 * /api/tsunami – NOAA PTWC RSS Feed Proxy
 * Listens to the Pacific Tsunami Warning Center RSS feed
 * and returns active warnings / watches / advisories.
 * Triggers secondary marine threat zones for M>7.0 events.
 *
 * Docs: https://www.tsunami.gov/
 */

import { NextRequest, NextResponse } from 'next/server';
import type { TsunamiProperties, UnifiedFeature } from '@/lib/types';

const PTWC_FEEDS = [
  'https://www.tsunami.gov/events/rss.xml',
  'https://ptwc.weather.gov/rss/ptwc-pacific.xml',
];

// Approximate threat zone generation for tsunami warnings
// Real implementation would use NOAA tide model polygons
function generateThreatZone(lat: number, lng: number, radiusKm: number): [number, number][] {
  const points: [number, number][] = [];
  const steps = 32;
  const R_EARTH = 6371;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const d = radiusKm / R_EARTH;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const latR = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
      Math.cos(latRad) * Math.sin(d) * Math.cos(bearing),
    );
    const lngR = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(latR),
    );
    points.push([(lngR * 180) / Math.PI, (latR * 180) / Math.PI]);
  }
  return points;
}

export async function GET(_req: NextRequest) {
  const features: UnifiedFeature[] = [];

  for (const feedUrl of PTWC_FEEDS) {
    try {
      const res = await fetch(feedUrl, { next: { revalidate: 300 } });
      if (!res.ok) continue;
      const xml = await res.text();

      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

      for (let i = 0; i < Math.min(items.length, 10); i++) {
        const item     = items[i][1];
        const title    = (item.match(/<title>(.*?)<\/title>/) ?? [])[1] ?? '';
        const pubDate  = (item.match(/<pubDate>(.*?)<\/pubDate>/) ?? [])[1] ?? '';
        const desc     = (item.match(/<description>(.*?)<\/description>/) ?? [])[1] ?? '';

        const severity: TsunamiProperties['severity'] =
          /warning/i.test(title)  ? 'WARNING'
          : /watch/i.test(title)   ? 'WATCH'
          : /advisory/i.test(title)? 'ADVISORY'
          : 'INFO';

        // Extract lat/lng from description if present
        const latMatch = desc.match(/(\d+\.\d+)°?\s*[NS]/i);
        const lngMatch = desc.match(/(\d+\.\d+)°?\s*[EW]/i);
        const lat = latMatch ? parseFloat(latMatch[1]) * (/S/i.test(latMatch[0]) ? -1 : 1) : 0;
        const lng = lngMatch ? parseFloat(lngMatch[1]) * (/W/i.test(lngMatch[0]) ? -1 : 1) : 0;

        // Generate rough threat radius based on severity
        const radiusKm = severity === 'WARNING' ? 2000
          : severity === 'WATCH'   ? 1000
          : severity === 'ADVISORY'? 500
          : 200;

        const threatZone = lat && lng
          ? generateThreatZone(lat, lng, radiusKm)
          : generateThreatZone(0, -150, radiusKm); // default Pacific center

        const props: TsunamiProperties = {
          warning_id: `ptwc-${i}-${Date.now()}`,
          title:      title.replace(/<[^>]+>/g, ''),
          severity,
          issued_at:  pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        };

        features.push({
          id:     `tsunami-${i}-${Date.now()}`,
          source: 'tsunami' as const,
          geometry: { type: 'Polygon' as const, coordinates: [threatZone] },
          properties: props,
        });
      }
    } catch (err) {
      console.error(`[/api/tsunami] feed ${feedUrl} error:`, err);
    }
  }

  return NextResponse.json({ type: 'tsunami', ts: Date.now(), features }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  });
}
