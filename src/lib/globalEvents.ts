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

// ── Unified Event Schema ─────────────────────────────────────

export type EventType =
  | 'tectonic'
  | 'volcanic'
  | 'landslide'
  | 'cryosphere'
  | 'subsidence'
  | 'mining'
  | 'induced_seismicity'
  | 'tsunami';

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

function deduplicateEvents(events: GlobalEvent[]): GlobalEvent[] {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (evs as any[]).map(sanitizeEvent).filter((e): e is GlobalEvent => e !== null);
}

// ── USGS fetcher ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
};

async function fetchEONET(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('eonet');
  if (cached) return cached;

  const url = '/api/global-events/eonet';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EONET ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();

  const events: GlobalEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of json.events ?? [] as any[]) {
    const catId: string = (ev.categories?.[0]?.id ?? '').toLowerCase().replace(/\s+/g, '');
    const mapped = EONET_CATEGORY_MAP[catId] ?? { type: 'tectonic' as EventType, cause: 'natural' as EventCause };

    for (const geo of ev.geometry ?? []) {
      if (!geo.coordinates) continue;
      const coords = geo.type === 'Point'
        ? geo.coordinates as [number, number]
        : geo.coordinates?.[0] as [number, number] | undefined;
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

  cacheSet('eonet', events);
  return sanitizeEvents(events);
}

// ── GVP / Smithsonian fetcher (via our proxy) ─────────────────

async function fetchGVP(): Promise<GlobalEvent[]> {
  const cached = cacheGet<GlobalEvent[]>('gvp');
  if (cached) return cached;

  const url = '/api/global-events/gvp';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GVP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

type FetcherName = 'USGS' | 'NASA EONET' | 'Smithsonian GVP' | 'NASA COOLR' | 'HiQuake';

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
    ['Smithsonian GVP', { name: 'Smithsonian GVP',  status: 'loading', lastUpdated: null }],
    ['NASA COOLR',      { name: 'NASA COOLR',       status: 'loading', lastUpdated: null }],
    ['HiQuake',         { name: 'HiQuake',          status: 'loading', lastUpdated: null }],
  ]);

  const updateHealth = (h: Partial<SourceHealth> & { name: string }) => {
    health.set(h.name, { ...health.get(h.name)!, ...h });
    onHealthUpdate(Array.from(health.values()));
  };

  const [usgs, eonet, gvp, coolr, hiquake] = await Promise.all([
    runFetcher('USGS',            fetchUSGS,   updateHealth),
    runFetcher('NASA EONET',      fetchEONET,  updateHealth),
    runFetcher('Smithsonian GVP', fetchGVP,    updateHealth),
    runFetcher('NASA COOLR',      fetchCOOLR,  updateHealth),
    runFetcher('HiQuake',         fetchHiQuake, updateHealth),
  ]);

  const all = [...usgs, ...eonet, ...gvp, ...coolr, ...hiquake];
  return deduplicateEvents(all);
}
