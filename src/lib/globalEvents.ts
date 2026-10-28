/**
 * ============================================================
 * Global Events – Unified Event Schema & Multi-Source Fetcher
 * ============================================================
 * Unified schema for all Earth-surface-displacement events,
 * natural and human-made.  Data is fetched from:
 *   - USGS FDSN  (earthquakes)
 *   - NASA EONET v3 (volcanoes, landslides, ice, earthquakes)
 *   - NOAA NCEI  (historical hazards)
 *   - Smithsonian GVP (volcanic eruptions)
 *   - NASA COOLR / Global Landslide Catalog (static snapshot)
 *   - HiQuake    (human-induced events, static snapshot)
 *
 * Each source is isolated so a failure never crashes the globe.
 * Results are deduplicated (≤50 km, ≤24 h same type) and
 * cached in localStorage with a per-source TTL.
 * ============================================================
 */

'use client';

import { MPH_TO_KT, kmhToKt } from './stormScale';

// ── Unified Event Schema ─────────────────────────────────────

export type EventType =
  | 'tectonic'
  | 'volcanic'
  | 'landslide'
  | 'cryosphere'
  | 'subsidence'
  | 'mining'
  | 'induced_seismicity'
  | 'tsunami'
  | 'storm';

export type EventCause = 'natural' | 'human';

export interface GlobalEvent {
  id:               string;
  type:             EventType;
  cause:            EventCause;
  title:            string;
  lat:              number;
  lon:              number;
  time:             number;        // epoch ms
  magnitude:        number | null; // Richter / VEI / other scale
  depth:            number | null; // km
  displacement_cm:  number | null; // nullable until detail step
  source:           string;        // e.g. "USGS" | "EONET" | "GVP"
  source_url:       string;
  sources:          string[];      // all sources if deduplicated
  /** Tropical cyclones: maximum sustained wind (knots), where the source reports it. */
  wind_kts?:        number | null;
  /** Tropical cyclones: minimum central pressure (hPa). */
  pressure_mb?:     number | null;
  /** Tropical cyclones: earlier positions, oldest first, as [lon, lat]. */
  track?:           [number, number][];
}

// ── Source status ─────────────────────────────────────────────

export type SourceStatus = 'ok' | 'loading' | 'error' | 'cached';

export interface SourceHealth {
  name:        string;
  status:      SourceStatus;
  lastUpdated: Date | null;
}

// ── Cache helpers ─────────────────────────────────────────────

const CACHE_TTL_MS: Record<string, number> = {
  usgs:  5  * 60 * 1000,  // 5 min
  eonet: 15 * 60 * 1000,  // 15 min
  noaa:  60 * 60 * 1000,  // 1 h
  gvp:   60 * 60 * 1000,  // 1 h
  coolr: 24 * 60 * 60 * 1000, // 24 h (static)
  hiquake: 24 * 60 * 60 * 1000, // 24 h (static)
};

/** Deterministic short id for records that arrive without one (never random: ids are used in URLs). */
function stableId(...parts: Array<string | number | null | undefined>): string {
  const str = parts.join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`gs_cache_v3_${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number };
    const ttl = CACHE_TTL_MS[key] ?? 300_000;
    if (Date.now() - ts > ttl) return null;
    return data;
  } catch { return null; }
}

function cacheSet<T>(key: string, data: T) {
  try {
    localStorage.setItem(`gs_cache_v3_${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded – ignore */ }
}

// ── Distance helper ───────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Deduplication ─────────────────────────────────────────────

export function deduplicateEvents(events: GlobalEvent[]): GlobalEvent[] {
  const dedupedMap = new Map<string, GlobalEvent>();
  const DIST_KM = 50;
  const TIME_MS = 24 * 60 * 60 * 1000;

  for (const ev of events) {
    let merged = false;
    for (const [key, existing] of dedupedMap) {
      if (
        existing.type === ev.type &&
        Math.abs(existing.time - ev.time) < TIME_MS &&
        haversineKm(existing.lat, existing.lon, ev.lat, ev.lon) < DIST_KM
      ) {
        // Merge sources; keep higher magnitude
        existing.sources = Array.from(new Set([...existing.sources, ...ev.sources]));
        if ((ev.magnitude ?? 0) > (existing.magnitude ?? 0)) {
          existing.magnitude = ev.magnitude;
        }
        dedupedMap.set(key, existing);
        merged = true;
        break;
      }
    }
    if (!merged) {
      dedupedMap.set(ev.id, ev);
    }
  }

  return Array.from(dedupedMap.values());
}

// ── Event sanitizer ────────────────────────────────────────────────
// Coerces numeric fields from strings/nulls and drops events with
// missing or out-of-range coordinates so bad API data never crashes
// the globe renderer.

 
function sanitizeEvent(ev: any): GlobalEvent | null {
  const lat = Number(ev.lat);
  const lon = Number(ev.lon);
  // Drop events without valid coordinates
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const time      = Number(ev.time);
  // An event with no valid timestamp is dropped: stamping it "now" would make old records look live.
  if (!isFinite(time)) return null;
  const magnitude = ev.magnitude != null ? Number(ev.magnitude) : null;
  const depth     = ev.depth     != null ? Number(ev.depth)     : null;

  return {
    ...ev,
    lat,
    lon,
    time,
    magnitude: magnitude != null && isFinite(magnitude) ? magnitude : null,
    depth:     depth     != null && isFinite(depth)     ? depth     : null,
  } as GlobalEvent;
}

function sanitizeEvents(evs: GlobalEvent[]): GlobalEvent[] {
   
  return (evs as any[]).map(sanitizeEvent).filter((e): e is GlobalEvent => e !== null);
}

// ── USGS fetcher ──────────────────────────────────────────────

 
export function mapUSGSFeature(f: any): GlobalEvent {
  const p = f.properties;
  const [lon, lat, depth] = f.geometry.coordinates as [number, number, number];
  return {
    id:              `usgs_${f.id}`,
    type:            'tectonic',
    cause:           'natural',
    title:           p.place ?? 'Earthquake',
    lat, lon,
    time:            p.time ?? 0,
    magnitude:       p.mag ?? null,
    depth:           depth ?? null,
    displacement_cm: null,
    source:          'USGS',
    source_url:      p.url ?? 'https://earthquake.usgs.gov',
    sources:         ['USGS'],
  };
}

/** One bounded slice of the USGS catalogue (used to keep loading older events as the user scrolls). */
export async function fetchUSGSWindow(startMs: number, endMs: number, signal?: AbortSignal, minMag = 3.5): Promise<GlobalEvent[]> {
  const qs = new URLSearchParams({
    minmagnitude: String(minMag), limit: '2000', orderby: 'time',
    starttime: new Date(startMs).toISOString(), endtime: new Date(endMs).toISOString(),
  });
  const res = await fetch(`/api/earthquakes?${qs}`, { signal });
  if (!res.ok) throw new Error(`USGS window ${res.status}`);
   
  const json: any = await res.json();
  return sanitizeEvents((json.features ?? []).map(mapUSGSFeature));
}

async function fetchUSGS(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('usgs');
  if (cached) return cached;

  const past30 = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const url = `/api/earthquakes?minmagnitude=3.5&limit=500&starttime=${past30}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000); // 10s timeout
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`USGS ${res.status}`);
     
    const json: any = await res.json();

     
    const events: GlobalEvent[] = (json.features ?? []).map((f: any) => {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates as [number, number, number];
      return {
        id:              `usgs_${f.id}`,
        type:            'tectonic' as EventType,
        cause:           'natural' as EventCause,
        title:           p.place ?? 'Earthquake',
        lat, lon,
        time:            p.time ?? 0,
        magnitude:       p.mag ?? null,
        depth:           depth ?? null,
        displacement_cm: null,
        source:          'USGS',
        source_url:      p.url ?? 'https://earthquake.usgs.gov',
        sources:         ['USGS'],
      };
    });

    cacheSet('usgs', events);
    return sanitizeEvents(events);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── NASA EONET v3 fetcher ─────────────────────────────────────

const EONET_CATEGORY_MAP: Record<string, { type: EventType; cause: EventCause }> = {
  volcanoes:   { type: 'volcanic',   cause: 'natural' },
  earthquakes: { type: 'tectonic',   cause: 'natural' },
  landslides:  { type: 'landslide',  cause: 'natural' },
  seaAndLakeIce: { type: 'cryosphere', cause: 'natural' },
  icebergs:    { type: 'cryosphere', cause: 'natural' },
  severestorms: { type: 'storm',    cause: 'natural' },
};

/** Turns an EONET v3 response into events. Shared by the live feed and the directory's history paging. */
 
export function eonetEventsFromJson(json: any): GlobalEvent[] {
  const events: GlobalEvent[] = [];
   
  for (const ev of json.events ?? [] as any[]) {
    const catId: string = (ev.categories?.[0]?.id ?? '').toLowerCase().replace(/\s+/g, '');
    // Categories we do not model (wildfires, floods, dust…) are skipped rather than mislabelled as earthquakes.
    const mapped = EONET_CATEGORY_MAP[catId.toLowerCase()] ?? EONET_CATEGORY_MAP[catId];
    if (!mapped) continue;

     
    const geos = ((ev.geometry ?? []) as any[]).filter(g => g?.coordinates).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const pointOf = (geo: { type?: string; coordinates: unknown }) =>
      (geo.type === 'Point' ? geo.coordinates : (geo.coordinates as unknown[])?.[0]) as [number, number] | undefined;

    if (mapped.type === 'storm') {
      // One record per storm: its latest position, with the earlier positions kept as the track.
      const last = geos[geos.length - 1]; const at = last && pointOf(last);
      if (!at) continue;
      const wind = geos.slice().reverse().map(g => {
        const v = Number(g.magnitudeValue); const u = String(g.magnitudeUnit ?? '').toLowerCase();
        return isFinite(v) && v > 0 ? (u.startsWith('kt') ? v : u.includes('mph') ? v * MPH_TO_KT : u.includes('km') ? kmhToKt(v) : null) : null;
      }).find(v => v != null) ?? null;
      events.push({
        id: `eonet_${ev.id}`, type: 'storm', cause: 'natural', title: ev.title ?? 'Tropical cyclone',
        lat: at[1], lon: at[0], time: new Date(last.date ?? Date.now()).getTime(),
        magnitude: null, depth: null, displacement_cm: null, wind_kts: wind,
        track: geos.slice(0, -1).map(pointOf).filter((p): p is [number, number] => !!p),
        source: 'NASA EONET', source_url: ev.link ?? 'https://eonet.gsfc.nasa.gov', sources: ['NASA EONET'],
      });
      continue;
    }

    for (const geo of geos) {
      const coords = pointOf(geo);
      if (!coords) continue;
      const [lon, lat] = coords;
      events.push({
        id:              `eonet_${ev.id}_${geo.date ?? ''}`,
        type:            mapped.type,
        cause:           mapped.cause,
        title:           ev.title ?? 'EONET Event',
        lat, lon,
        time:            new Date(geo.date ?? Date.now()).getTime(),
        magnitude:       null,
        depth:           null,
        displacement_cm: null,
        source:          'NASA EONET',
        source_url:      ev.link ?? 'https://eonet.gsfc.nasa.gov',
        sources:         ['NASA EONET'],
      });
    }
  }
  return events;
}

async function fetchEONET(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('eonet');
  if (cached) return cached;

  const url = '/api/global-events/eonet';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EONET ${res.status}`);
   
  const json: any = await res.json();

  const events = eonetEventsFromJson(json);

  cacheSet('eonet', events);
  return sanitizeEvents(events);
}

// ── GDACS tropical cyclones (via our proxy) ──────────────────

async function fetchGDACS(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('gdacs');
  if (cached) return cached;
  const res = await fetch('/api/global-events/gdacs');
  if (!res.ok) throw new Error(`GDACS ${res.status}`);
   
  const json: any = await res.json();
  const events: GlobalEvent[] = [];
   
  for (const f of (json.features ?? []) as any[]) {
    const p = f?.properties ?? {};
    const c = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (p.eventtype && p.eventtype !== 'TC') continue;
    if (!Array.isArray(c) || !isFinite(c[0]) || !isFinite(c[1])) continue;
    const sev = p.severitydata ?? {};
    const raw = Number(sev.severity);
    const unit = String(sev.severityunit ?? 'km/h').toLowerCase();
    const wind = isFinite(raw) && raw > 0 ? (unit.startsWith('kt') ? raw : unit.includes('mph') ? raw * MPH_TO_KT : kmhToKt(raw)) : null;
    const time = Date.parse(p.todate ?? p.datemodified ?? p.fromdate ?? '');
    if (!isFinite(time)) continue;
    const name = String(p.eventname || p.name || '').trim();
    events.push({
      id: `gdacs_TC_${p.eventid ?? name}`, type: 'storm', cause: 'natural',
      title: name ? `Tropical Cyclone ${name.replace(/-\d+$/, '')}` : String(p.name ?? 'Tropical cyclone'),
      lat: c[1], lon: c[0], time, magnitude: null, depth: null, displacement_cm: null, wind_kts: wind,
      source: 'GDACS', source_url: p.url?.report ?? p.url?.details ?? 'https://www.gdacs.org', sources: ['GDACS'],
    });
  }
  cacheSet('gdacs', events);
  return sanitizeEvents(events);
}

/** EONET and GDACS both report the same storms: merge them by name, keeping the richer record. */
export function mergeStorms(all: GlobalEvent[]): GlobalEvent[] {
  const storms = all.filter(e => e.type === 'storm');
  const rest = all.filter(e => e.type !== 'storm');
  const key = (e: GlobalEvent) => e.title.toLowerCase().replace(/^(super |severe )?(tropical (cyclone|storm|depression)|hurricane|typhoon|cyclone)\s+/, '').replace(/[^a-z0-9]+/g, '').replace(/\d+$/, '');
  const byName = new Map<string, GlobalEvent>();
  for (const e of storms) {
    const k = key(e) || e.id;
    const prev = byName.get(k);
    if (!prev) { byName.set(k, e); continue; }
    const [a, b] = prev.time >= e.time ? [prev, e] : [e, prev];
    byName.set(k, {
      ...a, wind_kts: a.wind_kts ?? b.wind_kts ?? null, pressure_mb: a.pressure_mb ?? b.pressure_mb ?? null,
      track: a.track?.length ? a.track : b.track,
      title: a.title.length >= b.title.length ? a.title : b.title,
      sources: Array.from(new Set([...a.sources, ...b.sources])),
    });
  }
  return [...rest, ...byName.values()];
}

// ── GVP / Smithsonian fetcher (via our proxy) ─────────────────

async function fetchGVP(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('gvp');
  if (cached) return cached;

  const url = '/api/global-events/gvp';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GVP ${res.status}`);
   
  const json: any = await res.json();

   
  const events: GlobalEvent[] = (json.events ?? []).filter((ev: any) => ev.time && !isNaN(new Date(ev.time).getTime())).map((ev: any) => ({
    id:              `gvp_${ev.id}`,
    type:            'volcanic' as EventType,
    cause:           'natural' as EventCause,
    title:           ev.title ?? 'Volcanic eruption',
    lat:             ev.lat,
    lon:             ev.lon,
    time:            new Date(ev.time).getTime(),
    magnitude:       ev.vei ?? null,
    depth:           null,
    displacement_cm: null,
    source:          'Smithsonian GVP',
    source_url:      ev.url ?? 'https://volcano.si.edu',
    sources:         ['Smithsonian GVP'],
  }));

  cacheSet('gvp', events);
  return sanitizeEvents(events);
}

// ── NASA COOLR static snapshot fetcher ───────────────────────

async function fetchCOOLR(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('coolr');
  if (cached) return cached;

  const url = '/api/global-events/coolr';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`COOLR ${res.status}`);
   
  const json: any = await res.json();

   
  const events: GlobalEvent[] = (json.events ?? []).map((ev: any) => ({
    id:              `coolr_${ev.id ?? stableId(ev.title, ev.lat, ev.lon, ev.time)}`,
    type:            'landslide' as EventType,
    cause:           'natural' as EventCause,
    title:           ev.title ?? 'Landslide',
    lat:             ev.lat,
    lon:             ev.lon,
    time:            new Date(ev.time ?? '2020-01-01').getTime(),
    magnitude:       null,
    depth:           null,
    displacement_cm: null,
    source:          'NASA COOLR',
    source_url:      'https://gpm.nasa.gov/landslides/index.html',
    sources:         ['NASA COOLR'],
  }));

  cacheSet('coolr', events);
  return sanitizeEvents(events);
}

// ── HiQuake static snapshot fetcher ──────────────────────────

async function fetchHiQuake(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('hiquake');
  if (cached) return cached;

  const url = '/api/global-events/hiquake';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HiQuake ${res.status}`);
   
  const json: any = await res.json();

   
  const events: GlobalEvent[] = (json.events ?? []).map((ev: any) => ({
    id:              `hq_${ev.id ?? stableId(ev.title, ev.lat, ev.lon, ev.time)}`,
    type:            (ev.type ?? 'induced_seismicity') as EventType,
    cause:           'human' as EventCause,
    title:           ev.title ?? 'Human-induced seismicity',
    lat:             ev.lat,
    lon:             ev.lon,
    time:            new Date(ev.time ?? '2015-01-01').getTime(),
    magnitude:       ev.magnitude ?? null,
    depth:           ev.depth ?? null,
    displacement_cm: null,
    source:          'HiQuake',
    source_url:      'https://inducedearthquakes.org',
    sources:         ['HiQuake'],
  }));

  cacheSet('hiquake', events);
  return sanitizeEvents(events);
}

// ── Master fetch function ────────────────────────────────────

export interface GlobalEventsResult {
  events:        GlobalEvent[];
  sourceHealth:  SourceHealth[];
  loading:       boolean;
}

type FetcherName = 'USGS' | 'NASA EONET' | 'GDACS' | 'Smithsonian GVP' | 'NASA COOLR' | 'HiQuake';

async function runFetcher(
  name: FetcherName,
  fn: () => Promise<GlobalEvent[]>,
  healthUpdater: (h: Partial<SourceHealth> & { name: string }) => void
): Promise<GlobalEvent[]> {
  healthUpdater({ name, status: 'loading', lastUpdated: null });
  try {
    const events = await fn();
    healthUpdater({ name, status: 'ok', lastUpdated: new Date() });
    return events;
  } catch (err) {
    console.warn(`[GlobalEvents] ${name} fetch failed:`, err);
    healthUpdater({ name, status: 'error', lastUpdated: null });
    return [];
  }
}

/**
 * Fetches all sources in parallel, deduplicates, and returns
 * combined events + per-source health status.
 */
export async function fetchAllGlobalEvents(
  onHealthUpdate: (health: SourceHealth[]) => void
): Promise<GlobalEvent[]> {
  const health: Map<string, SourceHealth> = new Map([
    ['USGS',            { name: 'USGS',            status: 'loading', lastUpdated: null }],
    ['NASA EONET',      { name: 'NASA EONET',       status: 'loading', lastUpdated: null }],
    ['GDACS',           { name: 'GDACS',            status: 'loading', lastUpdated: null }],
    ['Smithsonian GVP', { name: 'Smithsonian GVP',  status: 'loading', lastUpdated: null }],
    ['NASA COOLR',      { name: 'NASA COOLR',       status: 'loading', lastUpdated: null }],
    ['HiQuake',         { name: 'HiQuake',          status: 'loading', lastUpdated: null }],
  ]);

  const updateHealth = (h: Partial<SourceHealth> & { name: string }) => {
    health.set(h.name, { ...health.get(h.name)!, ...h });
    onHealthUpdate(Array.from(health.values()));
  };

  const [usgs, eonet, gdacs, gvp, coolr, hiquake] = await Promise.all([
    runFetcher('USGS',            fetchUSGS,   updateHealth),
    runFetcher('NASA EONET',      fetchEONET,  updateHealth),
    runFetcher('GDACS',           fetchGDACS,  updateHealth),
    runFetcher('Smithsonian GVP', fetchGVP,    updateHealth),
    runFetcher('NASA COOLR',      fetchCOOLR,  updateHealth),
    runFetcher('HiQuake',         fetchHiQuake, updateHealth),
  ]);

  const all = mergeStorms([...usgs, ...eonet, ...gdacs, ...gvp, ...coolr, ...hiquake]);
  return deduplicateEvents(all);
}
