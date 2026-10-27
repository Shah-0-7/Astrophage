/**
 * ============================================================
 * Event Directory – Shared Types
 * ============================================================
 * Types shared between the /events directory page,
 * summary drawer, and /events/[id] detail page.
 * ============================================================
 */

import type { EventType, EventCause } from './globalEvents';

// ── Type colors + metadata (mirrors TYPE_CONFIG in GlobalSchematicGlobe) ──
export interface TypeConfig {
  color:  string;
  label:  string;
  icon:   string;
}

export const EVENT_TYPE_CONFIG: Record<EventType, TypeConfig> = {
  tectonic:           { color: '#ef4444', label: 'Tectonic',           icon: '⊕' },
  volcanic:           { color: '#fb923c', label: 'Volcanic',            icon: '△' },
  landslide:          { color: '#a78bfa', label: 'Landslide',           icon: '▽' },
  cryosphere:         { color: '#60a5fa', label: 'Cryosphere',          icon: '❄' },
  subsidence:         { color: '#34d399', label: 'Subsidence',          icon: '↓' },
  mining:             { color: '#fbbf24', label: 'Mining',              icon: '⬡' },
  induced_seismicity: { color: '#f472b6', label: 'Induced Seismicity',  icon: '⚡' },
  tsunami:            { color: '#22d3ee', label: 'Tsunami',             icon: '〜' },
  storm:              { color: '#38bdf8', label: 'Tropical Cyclone',    icon: '🌀' },
};

export const CAUSE_LABELS: Record<EventCause, string> = {
  natural: 'Natural',
  human:   'Human-made',
};

export const CAUSE_COLORS: Record<EventCause, string> = {
  natural: '#4ade80',
  human:   '#f472b6',
};

// ── Continent / region bounding boxes ─────────────────────────
export interface RegionBox {
  id:    string;
  label: string;
  minLat: number; maxLat: number;
  minLon: number; maxLon: number;
}

export const REGIONS: RegionBox[] = [
  { id: 'north_america',  label: 'North America',   minLat: 14,  maxLat: 85,  minLon: -170, maxLon: -52 },
  { id: 'south_america',  label: 'South America',   minLat: -56, maxLat: 13,  minLon: -82,  maxLon: -34 },
  { id: 'europe',         label: 'Europe',           minLat: 35,  maxLat: 72,  minLon: -25,  maxLon: 45  },
  { id: 'africa',         label: 'Africa',           minLat: -35, maxLat: 37,  minLon: -18,  maxLon: 52  },
  { id: 'middle_east',    label: 'Middle East',      minLat: 12,  maxLat: 42,  minLon: 25,   maxLon: 65  },
  { id: 'central_asia',   label: 'Central Asia',     minLat: 35,  maxLat: 56,  minLon: 46,   maxLon: 90  },
  { id: 'east_asia',      label: 'East Asia',        minLat: 18,  maxLat: 54,  minLon: 90,   maxLon: 148 },
  { id: 'southeast_asia', label: 'Southeast Asia',   minLat: -11, maxLat: 28,  minLon: 93,   maxLon: 142 },
  { id: 'south_asia',     label: 'South Asia',       minLat: 5,   maxLat: 38,  minLon: 60,   maxLon: 97  },
  { id: 'oceania',        label: 'Oceania',          minLat: -50, maxLat: -10, minLon: 110,  maxLon: 180 },
  { id: 'pacific',        label: 'Pacific Ocean',    minLat: -60, maxLat: 65,  minLon: -180, maxLon: -120},
  { id: 'arctic',         label: 'Arctic / Polar',   minLat: 66,  maxLat: 90,  minLon: -180, maxLon: 180 },
  { id: 'antarctic',      label: 'Antarctic',        minLat: -90, maxLat: -60, minLon: -180, maxLon: 180 },
];

export function getRegion(lat: number, lon: number): string {
  for (const r of REGIONS) {
    if (lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon) {
      return r.id;
    }
  }
  return 'other';
}

// ── Time preset chips ─────────────────────────────────────────
export interface TimePreset {
  id:    string;
  label: string;
  ms:    number | null; // null = All time
}

export const TIME_PRESETS: TimePreset[] = [
  { id: '24h',   label: '24H',  ms: 24 * 3600_000 },
  { id: '7d',    label: '7D',   ms: 7  * 86400_000 },
  { id: '30d',   label: '30D',  ms: 30 * 86400_000 },
  { id: '1y',    label: '1Y',   ms: 365 * 86400_000 },
  { id: '10y',   label: '10Y',  ms: 3650 * 86400_000 },
  { id: 'all',   label: 'ALL',  ms: null },
];

// ── Sort options ──────────────────────────────────────────────
export type SortKey = 'newest' | 'oldest' | 'magnitude_desc' | 'nearest';

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'newest',         label: 'Newest' },
  { id: 'oldest',         label: 'Oldest' },
  { id: 'magnitude_desc', label: 'Largest magnitude' },
  { id: 'nearest',        label: 'Nearest' },
];

// ── Active filter summary for chips ───────────────────────────
export interface ActiveFilter {
  key:   string;
  label: string;
}
