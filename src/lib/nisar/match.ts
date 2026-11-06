import { PRODUCTS } from './catalog';
import { pointInRing } from './geometry';
import type { NisarCoverage, NisarScene } from './types';

/** Scenes whose footprint contains the point. */
export function scenesCovering(scenes: NisarScene[], lon: number, lat: number): NisarScene[] {
  return scenes.filter(s => {
    const [w, south, e, n] = s.bbox;
    if (lat < south - 1e-9 || lat > n + 1e-9) return false;
    // A footprint spanning more than 180° of longitude crosses the antimeridian; pointInRing handles that case.
    if (e - w <= 180 && (lon < w - 1e-9 || lon > e + 1e-9)) return false;
    return pointInRing(lon, lat, s.ring);
  });
}

export function summarizeCoverage(covering: NisarScene[], eventTime: number): NisarCoverage {
  const byProduct: NisarCoverage['byProduct'] = {};
  let first: number | null = null, last: number | null = null, after = 0;
  for (const s of covering) {
    byProduct[s.product] = (byProduct[s.product] ?? 0) + 1;
    if (first == null || s.start < first) first = s.start;
    if (last == null || s.end > last) last = s.end;
    if (s.start > eventTime) after++;
  }
  return { total: covering.length, firstSeen: first, lastSeen: last, afterEvent: after, byProduct };
}

export type InsarFit = 'spans-event' | 'after-event';
export interface InsarMatch { scene: NisarScene; fit: InsarFit; spanDays: number }

/**
 * Interferogram products over the point, classified against the event time:
 *  - spans-event: the pair's reference date is before the event and its secondary date after it, so the interferogram
 *    should contain the event's ground motion (alongside anything else that moved in that window).
 *  - after-event: both acquisitions are after the event; useful for post-event change, not for the event itself.
 * Pairs that end before the event are dropped. Shorter spans come first (less unrelated motion in them).
 */
export function matchInterferograms(scenes: NisarScene[], lon: number, lat: number, eventTime: number): InsarMatch[] {
  const out: InsarMatch[] = [];
  for (const s of scenesCovering(scenes, lon, lat)) {
    if (!PRODUCTS[s.product].insar || !s.pair) continue;
    const { reference, secondary } = s.pair;
    const spanDays = Math.max(0, (secondary - reference) / 86_400_000);
    if (reference <= eventTime && secondary >= eventTime) out.push({ scene: s, fit: 'spans-event', spanDays });
    else if (reference > eventTime) out.push({ scene: s, fit: 'after-event', spanDays });
  }
  const rank = (m: InsarMatch) => (m.fit === 'spans-event' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.spanDays - b.spanDays || a.scene.id.localeCompare(b.scene.id));
}
