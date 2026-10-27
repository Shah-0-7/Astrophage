/**
 * ============================================================
 * useEventDirectory – Extended data hook for /events
 * ============================================================
 * Wraps useGlobalEvents and adds:
 *  - URL-synced filter / search / sort state
 *  - Fuzzy search via Fuse.js
 *  - On-demand USGS + EONET range fetching
 *  - Deduplicated merge with existing cache
 *  - Abort-controller for race-free filter transitions
 * ============================================================
 */

'use client';

import {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Fuse from 'fuse.js';
import {
  fetchAllGlobalEvents,
  fetchUSGSWindow,
  type GlobalEvent,
  type SourceHealth,
  type EventType,
  type EventCause,
} from './globalEvents';
import {
  getRegion,
  type SortKey,
} from './eventDirectoryTypes';

export type { GlobalEvent, SourceHealth, EventType, EventCause };

// ── Filter state ──────────────────────────────────────────────

export interface DirectoryFilters {
  search:       string;
  types:        EventType[];
  cause:        'all' | 'natural' | 'human';
  region:       string;        // '' = any
  placeSearch:  string;
  timePreset:   string;        // '24h' | '7d' | '30d' | '1y' | '10y' | 'all' | 'custom'
  customStart:  string;        // ISO date string
  customEnd:    string;
  magMin:       number;
  magMax:       number;
  sort:         SortKey;
  nearMe:       boolean;
  nearRadius:   number;        // km
  selectedId:   string;        // ?event=ID  – opens drawer
}

const DEFAULT_FILTERS: DirectoryFilters = {
  search: '', types: [], cause: 'all', region: '',
  placeSearch: '', timePreset: 'all', customStart: '', customEnd: '',
  magMin: 0, magMax: 10, sort: 'newest',
  nearMe: false, nearRadius: 500, selectedId: '',
};

// ── Haversine ─────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── localStorage cache helpers (per-query) ────────────────────

const RANGE_TTL = 5 * 60_000; // 5 min for USGS range fetches
const FLOOR_MS  = Date.UTC(1970, 0, 1); // how far back "load more" will go

function rangeCacheKey(source: string, start: string, end: string) {
  return `dir_range_${source}_${start}_${end}`;
}

function cacheGet<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number };
    if (Date.now() - ts > ttl) return null;
    return data;
  } catch { return null; }
}

function cacheSet<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota */ }
}

// ── Merge & deduplicate two arrays ────────────────────────────

function mergeEvents(base: GlobalEvent[], incoming: GlobalEvent[]): GlobalEvent[] {
  const byId = new Map<string, GlobalEvent>(base.map(e => [e.id, e]));
  for (const ev of incoming) {
    if (!byId.has(ev.id)) byId.set(ev.id, ev);
  }
  return Array.from(byId.values());
}

// ── On-demand USGS range fetch ─────────────────────────────────

async function fetchUSGSRange(start: string, end: string, signal: AbortSignal): Promise<GlobalEvent[]> {
  const key = rangeCacheKey('usgs', start, end);
  const cached = cacheGet<GlobalEvent[]>(key, RANGE_TTL);
  if (cached) return cached;

  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}&minmagnitude=4.5&limit=5000`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`USGS range ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: GlobalEvent[] = (json.features ?? []).map((f: any) => {
    const p = f.properties;
    const [lon, lat, depth] = f.geometry.coordinates as [number, number, number];
    return {
      id: `usgs_${f.id}`,
      type: 'tectonic' as EventType,
      cause: 'natural' as EventCause,
      title: p.place ?? 'Earthquake',
      lat, lon,
      time: p.time ?? 0,
      magnitude: p.mag ?? null,
      depth: depth ?? null,
      displacement_cm: null,
      source: 'USGS',
      source_url: p.url ?? 'https://earthquake.usgs.gov',
      sources: ['USGS'],
    };
  });
  cacheSet(key, events);
  return events;
}

// ── On-demand EONET range fetch ────────────────────────────────

async function fetchEONETRange(start: string, end: string, signal: AbortSignal): Promise<GlobalEvent[]> {
  const key = rangeCacheKey('eonet', start, end);
  const cached = cacheGet<GlobalEvent[]>(key, RANGE_TTL);
  if (cached) return cached;

  const url = `/api/global-events/eonet?start=${start}&end=${end}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`EONET range ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();

  const EONET_CAT_MAP: Record<string, { type: EventType; cause: EventCause }> = {
    volcanoes:     { type: 'volcanic',   cause: 'natural' },
    earthquakes:   { type: 'tectonic',   cause: 'natural' },
    landslides:    { type: 'landslide',  cause: 'natural' },
    seaAndLakeIce: { type: 'cryosphere', cause: 'natural' },
    icebergs:      { type: 'cryosphere', cause: 'natural' },
  };

  const events: GlobalEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of json.events ?? [] as any[]) {
    const catId = (ev.categories?.[0]?.id ?? '').toLowerCase().replace(/\s+/g, '');
    const mapped = EONET_CAT_MAP[catId] ?? { type: 'tectonic' as EventType, cause: 'natural' as EventCause };
    for (const geo of ev.geometry ?? []) {
      if (!geo.coordinates) continue;
      const coords = geo.type === 'Point'
        ? geo.coordinates as [number, number]
        : geo.coordinates?.[0] as [number, number] | undefined;
      if (!coords) continue;
      const [lon, lat] = coords;
      events.push({
        id: `eonet_${ev.id}_${geo.date ?? ''}`,
        type: mapped.type, cause: mapped.cause,
        title: ev.title ?? 'EONET Event',
        lat, lon,
        time: new Date(geo.date ?? Date.now()).getTime(),
        magnitude: null, depth: null, displacement_cm: null,
        source: 'NASA EONET',
        source_url: ev.link ?? 'https://eonet.gsfc.nasa.gov',
        sources: ['NASA EONET'],
      });
    }
  }

  cacheSet(key, events);
  return events;
}

// ── URL ↔ filter sync ─────────────────────────────────────────

function filtersToParams(f: DirectoryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search)       p.set('q', f.search);
  if (f.types.length) p.set('types', f.types.join(','));
  if (f.cause !== 'all') p.set('cause', f.cause);
  if (f.region)       p.set('region', f.region);
  if (f.placeSearch)  p.set('place', f.placeSearch);
  if (f.timePreset !== 'all') p.set('time', f.timePreset);
  if (f.timePreset === 'custom') {
    if (f.customStart) p.set('from', f.customStart);
    if (f.customEnd)   p.set('to',   f.customEnd);
  }
  if (f.magMin > 0)   p.set('magMin', String(f.magMin));
  if (f.magMax < 10)  p.set('magMax', String(f.magMax));
  if (f.sort !== 'newest') p.set('sort', f.sort);
  if (f.nearMe)       p.set('nearMe', '1');
  if (f.nearRadius !== 500) p.set('radius', String(f.nearRadius));
  if (f.selectedId)   p.set('event', f.selectedId);
  return p;
}

function paramsToFilters(sp: URLSearchParams): DirectoryFilters {
  const types = sp.get('types')
    ? (sp.get('types')!.split(',') as EventType[])
    : [];
  return {
    search:      sp.get('q') ?? '',
    types,
    cause:       (sp.get('cause') as DirectoryFilters['cause']) ?? 'all',
    region:      sp.get('region') ?? '',
    placeSearch: sp.get('place') ?? '',
    timePreset:  sp.get('time') ?? 'all',
    customStart: sp.get('from') ?? '',
    customEnd:   sp.get('to') ?? '',
    magMin:      Number(sp.get('magMin') ?? 0),
    magMax:      Number(sp.get('magMax') ?? 10),
    sort:        (sp.get('sort') as SortKey) ?? 'newest',
    nearMe:      sp.get('nearMe') === '1',
    nearRadius:  Number(sp.get('radius') ?? 500),
    selectedId:  sp.get('event') ?? '',
  };
}

// ── Time window from filter ────────────────────────────────────

function resolveTimeWindow(f: DirectoryFilters): { start: number; end: number } | null {
  const now = Date.now();
  if (f.timePreset === 'custom') {
    const start = f.customStart ? new Date(f.customStart).getTime() : 0;
    const end   = f.customEnd   ? new Date(f.customEnd).getTime()   : now;
    return { start, end };
  }
  const PRESETS: Record<string, number | null> = {
    '24h': 24 * 3600_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000,
    '1y': 365 * 86400_000, '10y': 3650 * 86400_000, 'all': null,
  };
  const ms = PRESETS[f.timePreset] ?? null;
  if (ms === null) return null;
  return { start: now - ms, end: now };
}

// ── Hook return type ──────────────────────────────────────────

export interface UseEventDirectoryReturn {
  allEvents:       GlobalEvent[];
  filteredEvents:  GlobalEvent[];
  sourceHealth:    SourceHealth[];
  loading:         boolean;
  rangeLoading:    boolean;
  filters:         DirectoryFilters;
  setFilters:      (patch: Partial<DirectoryFilters>) => void;
  clearFilters:    () => void;
  totalCount:      number;
  matchCount:      number;
  userLocation:    [number, number] | null;
  locationError:   string | null;
  requestLocation: () => void;
  refresh:         () => void;
  /** Fetch the next slice of older events (keeps the list growing as the user scrolls). */
  loadMore:        () => void;
  loadingMore:     boolean;
  /** False when the current time filter already covers everything that can be loaded. */
  hasMore:         boolean;
  /** Oldest point in time that has been loaded so far (epoch ms), or null before the first load. */
  loadedBack:      number | null;
}

// ── Hook ──────────────────────────────────────────────────────

export function useEventDirectory(): UseEventDirectoryReturn {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // ── Decode filters from URL ───────────────────────────────
  const filters = useMemo(
    () => paramsToFilters(searchParams),
    [searchParams]
  );

  const setFilters = useCallback((patch: Partial<DirectoryFilters>) => {
    const next = filtersToParams({ ...filters, ...patch });
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [filters, pathname, router]);

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // ── Base events (the hook used on the globe) ──────────────
  const [allEvents,    setAllEvents]    = useState<GlobalEvent[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [tick, setTick] = useState(0);
  const abortRef = useRef(false);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    abortRef.current = false;
    setLoading(true);
    const safety = setTimeout(() => { if (!abortRef.current) setLoading(false); }, 12_000);

    fetchAllGlobalEvents(h => { if (!abortRef.current) setSourceHealth(h); })
      .then(evts => { if (!abortRef.current) { setAllEvents(evts); setLoading(false); } })
      .catch(() => { if (!abortRef.current) setLoading(false); })
      .finally(() => clearTimeout(safety));

    return () => { abortRef.current = true; clearTimeout(safety); };
  }, [tick]);

  // ── On-demand range fetch (when time window exceeds 30d) ──
  const [rangeEvents,  setRangeEvents]  = useState<GlobalEvent[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const rangeAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const tw = resolveTimeWindow(filters);
    if (!tw) return; // "all" — base events cover it
    const thirtyDays = 30 * 86400_000;
    const now = Date.now();
    if (now - tw.start <= thirtyDays) return; // within cached window

    // Need more history
    rangeAbort.current?.abort();
    const ctrl = new AbortController();
    rangeAbort.current = ctrl;

    setRangeLoading(true);
    const startStr = new Date(tw.start).toISOString();
    const endStr   = new Date(Math.min(tw.end, now - thirtyDays)).toISOString();

    Promise.allSettled([
      fetchUSGSRange(startStr, endStr, ctrl.signal),
      fetchEONETRange(startStr, endStr, ctrl.signal),
    ]).then(results => {
      if (ctrl.signal.aborted) return;
      const extra = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      setRangeEvents(extra);
      setRangeLoading(false);
    });

    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.timePreset, filters.customStart, filters.customEnd]);

  // ── Progressive history: older USGS slices appended on demand ─
  const [history,     setHistory]     = useState<GlobalEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted,   setExhausted]   = useState(false);
  const cursorRef  = useRef<number | null>(null);   // everything newer than this has been requested
  const busyRef    = useRef(false);
  const spanRef    = useRef(7 * 86400_000);          // widens across quiet stretches
  const [loadedBack, setLoadedBack] = useState<number | null>(null);

  const loadMore = useCallback(() => {
    if (busyRef.current || exhausted) return;
    if (cursorRef.current === null) {
      // Start where the base feed stops: its oldest USGS event (the base fetch is capped at a fixed count).
      const usgs = allEvents.filter(e => e.id.startsWith('usgs_'));
      if (!usgs.length) return;
      cursorRef.current = usgs.reduce((m, e) => Math.min(m, e.time), Infinity);
    }
    const end = cursorRef.current;
    if (end <= FLOOR_MS) { setExhausted(true); return; }
    const start = Math.max(FLOOR_MS, end - spanRef.current);
    busyRef.current = true;
    setLoadingMore(true);
    fetchUSGSWindow(start, end)
      .then(evts => {
        cursorRef.current = start;
        setLoadedBack(start);
        // Quiet window → look further next time; busy window → keep slices small.
        spanRef.current = evts.length === 0 ? Math.min(spanRef.current * 2, 365 * 86400_000)
                         : evts.length > 1200 ? Math.max(86400_000, spanRef.current / 2) : spanRef.current;
        if (evts.length) setHistory(h => mergeEvents(h, evts));
      })
      .catch(() => { /* transient – the next scroll retries */ })
      .finally(() => { busyRef.current = false; setLoadingMore(false); });
  }, [allEvents, exhausted]);

  // ── Merged event set ──────────────────────────────────────
  const merged = useMemo(
    () => mergeEvents(mergeEvents(allEvents, rangeEvents), history),
    [allEvents, rangeEvents, history]
  );

  // ── Geolocation ───────────────────────────────────────────
  const [userLocation,  setUserLocation]  = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported.'); return;
    }
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      pos => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      err => setLocationError(err.code === 1 ? 'Location permission denied.' : 'Unable to retrieve location.'),
      { timeout: 8000, enableHighAccuracy: false }
    );
  }, []);

  // Auto-request if nearMe filter is active
  useEffect(() => {
    if (filters.nearMe && !userLocation) requestLocation();
  }, [filters.nearMe, userLocation, requestLocation]);

  // ── Fuse.js fuzzy search ──────────────────────────────────
  const fuse = useMemo(() => new Fuse(merged, {
    keys: ['title', 'source', 'type', 'cause'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  }), [merged]);

  // ── Time window ───────────────────────────────────────────
  const timeWindow = useMemo(() => resolveTimeWindow(filters), [filters]);

  // ── Apply all filters ─────────────────────────────────────
  const filteredEvents = useMemo(() => {
    let pool: GlobalEvent[] = merged;

    // 1. Fuzzy search
    if (filters.search.trim().length >= 2) {
      pool = fuse.search(filters.search).map(r => r.item);
      // Also re-run on the filtered set below to preserve order
    } else if (filters.search.trim().length > 0) {
      const q = filters.search.toLowerCase();
      pool = pool.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.type.includes(q) ||
        e.source.toLowerCase().includes(q)
      );
    }

    // 2. Type filter
    if (filters.types.length > 0) {
      pool = pool.filter(e => filters.types.includes(e.type));
    }

    // 3. Cause filter
    if (filters.cause !== 'all') {
      pool = pool.filter(e => e.cause === filters.cause);
    }

    // 4. Region filter
    if (filters.region) {
      pool = pool.filter(e => getRegion(e.lat, e.lon) === filters.region);
    }

    // 5. Place text search
    if (filters.placeSearch.trim()) {
      const q = filters.placeSearch.toLowerCase();
      pool = pool.filter(e => e.title.toLowerCase().includes(q));
    }

    // 6. Time window
    if (timeWindow) {
      pool = pool.filter(e => e.time >= timeWindow.start && e.time <= timeWindow.end);
    }

    // 7. Magnitude range (only for events that have magnitude)
    if (filters.magMin > 0 || filters.magMax < 10) {
      pool = pool.filter(e => {
        if (e.magnitude === null) return filters.magMin === 0;
        return e.magnitude >= filters.magMin && e.magnitude <= filters.magMax;
      });
    }

    // 8. Near Me
    if (filters.nearMe && userLocation) {
      pool = pool.filter(e =>
        haversineKm(userLocation[0], userLocation[1], e.lat, e.lon) <= filters.nearRadius
      );
    }

    // 9. Sort
    pool = [...pool].sort((a, b) => {
      switch (filters.sort) {
        case 'oldest':         return a.time - b.time;
        case 'magnitude_desc': return (b.magnitude ?? 0) - (a.magnitude ?? 0);
        case 'nearest':
          if (!userLocation) return b.time - a.time;
          return haversineKm(userLocation[0], userLocation[1], a.lat, a.lon)
               - haversineKm(userLocation[0], userLocation[1], b.lat, b.lon);
        case 'newest':
        default:               return b.time - a.time;
      }
    });

    return pool;
  }, [merged, filters, fuse, timeWindow, userLocation]);

  return {
    allEvents:      merged,
    filteredEvents,
    sourceHealth,
    loading,
    rangeLoading,
    filters,
    setFilters,
    clearFilters,
    totalCount:     merged.length,
    matchCount:     filteredEvents.length,
    userLocation,
    locationError,
    requestLocation,
    refresh,
    loadMore,
    loadingMore,
    hasMore: !exhausted && !loading && filters.timePreset === 'all',
    loadedBack,
  };
}
