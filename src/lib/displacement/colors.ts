/** Colour scales for the displacement drape. Pure so they can be tested; the view turns them into vertex colours. */
import { FRINGE_CM } from './field';

export type RGB = [number, number, number]; // 0..1

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Diverging: away from satellite (blue) – none (near white) – toward satellite (red/orange).
const AWAY: RGB = [0.13, 0.4, 0.85], ZERO: RGB = [0.93, 0.93, 0.93], TOWARD: RGB = [0.92, 0.28, 0.14];

/** Continuous LOS colour; `limit` is the value (cm) at which the scale saturates. */
export function losColor(cm: number, limit: number): RGB {
  const t = Math.max(-1, Math.min(1, cm / Math.max(limit, 1e-6)));
  return t >= 0 ? lerp(ZERO, TOWARD, t) : lerp(ZERO, AWAY, -t);
}

/** hsl (h in 0..1, s,l in 0..1) to rgb */
function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Wrapped-phase look: the colour cycles once for every `fringe` cm of LOS motion (half the L-band wavelength). */
export function fringeColor(cm: number, fringe = FRINGE_CM): RGB {
  const frac = ((cm / fringe) % 1 + 1) % 1;
  return hsl(frac, 0.85, 0.52);
}

/** Round the scale limit up to a tidy number so the legend reads well. */
export function niceLimit(maxAbsCm: number): number {
  if (!(maxAbsCm > 0)) return 1;
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 3000];
  return steps.find(s => s >= maxAbsCm) ?? 3276;
}
