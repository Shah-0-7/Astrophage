import { describe, expect, it } from 'vitest';
import { fringeColor, losColor, niceLimit } from '@/lib/displacement/colors';
import { FRINGE_CM } from '@/lib/displacement/field';

describe('displacement colours', () => {
  it('is near-white at zero and saturated at the limit, red toward and blue away', () => {
    const z = losColor(0, 10), t = losColor(10, 10), a = losColor(-10, 10);
    expect(z.every(v => v > 0.9)).toBe(true);
    expect(t[0]).toBeGreaterThan(t[2]); expect(a[2]).toBeGreaterThan(a[0]);
    expect(losColor(50, 10)).toEqual(t); expect(losColor(-50, 10)).toEqual(a); // clamps
  });
  it('fringes repeat every half wavelength, in both directions', () => {
    const c = fringeColor(3);
    expect(fringeColor(3 + FRINGE_CM)).toEqual(c.map(v => expect.closeTo(v, 6)));
    expect(fringeColor(3 - 2 * FRINGE_CM)).toEqual(c.map(v => expect.closeTo(v, 6)));
    expect(fringeColor(0)).not.toEqual(fringeColor(FRINGE_CM / 2));
    expect(fringeColor(-1).every(v => v >= 0 && v <= 1)).toBe(true);
  });
  it('rounds scale limits up to tidy values', () => {
    expect(niceLimit(0)).toBe(1); expect(niceLimit(0.4)).toBe(1); expect(niceLimit(4.2)).toBe(5); expect(niceLimit(31)).toBe(50); expect(niceLimit(1e9)).toBe(3276);
  });
});
