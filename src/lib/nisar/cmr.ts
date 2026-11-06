/**
 * NASA CMR (Common Metadata Repository) access for NISAR granules.
 *
 * Searching CMR needs no login. The files themselves (HDF5, often gigabytes) need a free Earthdata Login, so this app
 * only reads the catalogue: where and when NISAR observed, and which interferogram products exist.
 */

import { ALL_PRODUCTS, MATURITIES, collectionName, parseCollection, PRODUCTS } from './catalog';
import { bboxOfRing, clampBBox, type BBox, type Ring } from './geometry';
import type { NisarMaturity, NisarProduct, NisarScene } from './types';

export const CMR_BASE = 'https://cmr.earthdata.nasa.gov/search';

export interface GranuleQuery {
  products?: NisarProduct[];
  maturities?: NisarMaturity[];
  /** [lon, lat] */
  point?: [number, number];
  bbox?: BBox;
  /** epoch ms; either end may be omitted for an open range */
  from?: number;
  to?: number;
  limit?: number;
  order?: 'newest' | 'oldest';
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function buildGranuleUrl(q: GranuleQuery): string {
  const parts: string[] = [];
  for (const p of q.products?.length ? q.products : ALL_PRODUCTS)
    for (const m of q.maturities?.length ? q.maturities : MATURITIES) parts.push(`short_name[]=${collectionName(p, m)}`);
  if (q.point) parts.push(`point=${+q.point[0].toFixed(4)},${+q.point[1].toFixed(4)}`);
  else if (q.bbox) parts.push(`bounding_box=${clampBBox(q.bbox).map(v => +v.toFixed(4)).join(',')}`);
  if (q.from != null || q.to != null) parts.push(`temporal[]=${q.from != null ? iso(q.from) : ''},${q.to != null ? iso(q.to) : ''}`);
  parts.push(`page_size=${Math.min(Math.max(q.limit ?? 100, 1), 500)}`);
  parts.push(`sort_key[]=${q.order === 'oldest' ? 'start_date' : '-start_date'}`);
  return `${CMR_BASE}/granules.umm_json?${parts.join('&')}`;
}

// ── Parsing ───────────────────────────────────────────────────

const STAMP = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/g;
const stampMs = (m: RegExpMatchArray) => Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
const DAY = 86_400_000;

/**
 * Pulls cycle / track / direction / frame and any timestamps out of a NISAR file name, for example
 * `NISAR_L2_PR_GCOV_004_004_A_018_4005_DHDH_A_20251029T111130_20251029T111153_P05023_N_P_J_001`.
 * Every field is optional: if the name does not follow the pattern the scene is still usable from CMR metadata.
 */
export function parseGranuleName(name: string): { cycle?: number; track?: number; direction?: 'A' | 'D'; frame?: number; stamps: number[] } {
  const stamps = [...name.matchAll(STAMP)].map(stampMs);
  const m = /^NISAR_L\d_[A-Z]{2}_[A-Z0-9]{4}_(\d{3})_(\d{3})_([AD])_(\d{3})_/.exec(name);
  return m ? { cycle: +m[1], track: +m[2], direction: m[3] as 'A' | 'D', frame: +m[4], stamps } : { stamps };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v: unknown): number | null => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function ringOf(geometry: Json | undefined): Ring | null {
  const poly = geometry?.GPolygons?.[0]?.Boundary?.Points;
  if (Array.isArray(poly)) {
    const ring: Ring = [];
    for (const p of poly) { const x = num(p?.Longitude), y = num(p?.Latitude); if (x == null || y == null) return null; ring.push([x, y]); }
    return ring.length >= 3 ? ring : null;
  }
  const r = geometry?.BoundingRectangles?.[0];
  if (r) {
    const w = num(r.WestBoundingCoordinate), e = num(r.EastBoundingCoordinate), s = num(r.SouthBoundingCoordinate), n = num(r.NorthBoundingCoordinate);
    if (w != null && e != null && s != null && n != null) return [[w, s], [e, s], [e, n], [w, n], [w, s]];
  }
  return null;
}

/** Turns a CMR `granules.umm_json` response into scenes. Malformed items are skipped, never thrown on. */
export function parseGranules(json: unknown): NisarScene[] {
  const items = (json as Json | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: NisarScene[] = [];
  for (const it of items) {
    try {
      const umm: Json = it?.umm ?? {};
      const id = typeof umm.GranuleUR === 'string' ? umm.GranuleUR.replace(/\.(h5|nc)$/i, '') : null;
      const col = parseCollection(umm.CollectionReference?.ShortName ?? '');
      const range = umm.TemporalExtent?.RangeDateTime;
      const t0 = ms(range?.BeginningDateTime), t1 = ms(range?.EndingDateTime) ?? t0;
      const ring = ringOf(umm.SpatialExtent?.HorizontalSpatialDomain?.Geometry);
      if (!id || !col || t0 == null || t1 == null || !ring) continue;

      const info = parseGranuleName(id);
      let pair: NisarScene['pair'];
      if (PRODUCTS[col.product].insar) {
        if (info.stamps.length >= 4) {
          const a = info.stamps[0], b = info.stamps[2];
          pair = { reference: Math.min(a, b), secondary: Math.max(a, b), source: 'name' };
        } else if (t1 - t0 > DAY) pair = { reference: t0, secondary: t1, source: 'metadata' };
      }

      const urls: Json[] = Array.isArray(umm.RelatedUrls) ? umm.RelatedUrls : [];
      const data = urls.find(u => u?.Type === 'GET DATA' && typeof u.URL === 'string' && /^https:\/\//.test(u.URL));
      const bytes = num(umm.DataGranule?.ArchiveAndDistributionInformation?.[0]?.SizeInBytes);
      const conceptId: string | undefined = typeof it?.meta?.['concept-id'] === 'string' ? it.meta['concept-id'] : undefined;
      out.push({
        id, conceptId, collection: umm.CollectionReference.ShortName, product: col.product, maturity: col.maturity,
        start: t0, end: t1, cycle: info.cycle, track: info.track, direction: info.direction, frame: info.frame, pair,
        ring, bbox: bboxOfRing(ring), dataUrl: data?.URL,
        sizeMb: bytes != null ? Math.round(bytes / 1_048_576) : undefined,
        metadataUrl: conceptId ? `${CMR_BASE}/concepts/${conceptId}.html` : `${CMR_BASE}/granules?granule_ur=${encodeURIComponent(id)}`,
      });
    } catch { /* skip malformed item */ }
  }
  return out;
}
