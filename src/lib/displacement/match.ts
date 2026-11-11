import type { FieldMeta } from './field';

/** Grids that contain the point and whose two acquisition dates enclose the time, shortest pair first. Same rule as the server lookup. */
export function matchFields<T extends Pick<FieldMeta, 'bbox' | 'reference' | 'secondary'>>(metas: readonly T[], p: { lat: number; lon: number; time: number }): T[] {
  return metas
    .filter(m => p.lon >= m.bbox[0] && p.lon <= m.bbox[2] && p.lat >= m.bbox[1] && p.lat <= m.bbox[3] && m.reference <= p.time && p.time <= m.secondary)
    .sort((a, b) => (a.secondary - a.reference) - (b.secondary - b.reference));
}

/** "−8.1 to +12.4 CM" */
export function fmtRangeCm(lo: number, hi: number): string {
  const f = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
  return `${f(lo)} to ${f(hi)} CM`;
}
