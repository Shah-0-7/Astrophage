/** Small geometry helpers for scene footprints. Longitudes are handled across the antimeridian. */

export type Ring = [number, number][];
export type BBox = [number, number, number, number]; // west, south, east, north

export function bboxOfRing(ring: Ring): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

/** A ring that jumps by more than 180° between neighbours crosses the antimeridian: shift western longitudes east. */
function unwrap(ring: Ring): { pts: Ring; shifted: boolean } {
  let jumps = false;
  for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { jumps = true; break; }
  return jumps ? { pts: ring.map(([x, y]) => [x < 0 ? x + 360 : x, y] as [number, number]), shifted: true } : { pts: ring, shifted: false };
}

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  if (ring.length < 3) return false;
  const { pts, shifted } = unwrap(ring);
  const x = shifted && lon < 0 ? lon + 360 : lon;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > lat) !== (yj > lat) && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function clampBBox([w, s, e, n]: BBox): BBox {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [c(w, -180, 180), c(s, -90, 90), c(e, -180, 180), c(n, -90, 90)];
}
