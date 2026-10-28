import { describe, it, expect } from 'vitest';
import { searchPlaces, normalize } from '@/lib/placeSearch';

describe('searchPlaces', () => {
  it('finds Tokyo first', () => {
    const r = searchPlaces('tokyo');
    expect(r[0].name).toBe('Tokyo');
    expect(r[0].lon).toBeCloseTo(139.75, 1);
  });
  it('prefers the capital among same-named places', () => {
    const r = searchPlaces('london');
    expect(r[0].lat).toBeCloseTo(51.5, 0);
  });
  it('matches prefixes and ignores accents', () => {
    expect(searchPlaces('sao pa').some(p => normalize(p.name) === 'sao paulo')).toBe(true);
  });
  it('returns nothing for very short or unknown queries', () => {
    expect(searchPlaces('t')).toEqual([]);
    expect(searchPlaces('zzzzqqq')).toEqual([]);
  });
  it('respects the limit', () => { expect(searchPlaces('san', 3).length).toBeLessThanOrEqual(3); });
});
