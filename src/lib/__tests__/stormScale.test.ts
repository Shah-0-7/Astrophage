import { describe, expect, it } from 'vitest';
import { basinName, classifyStorm, fmtWind, stormOf } from '../stormScale';

describe('classifyStorm (Saffir–Simpson, knots)', () => {
  it('returns null without a usable wind speed', () => {
    expect(classifyStorm(null)).toBeNull();
    expect(classifyStorm(0)).toBeNull();
    expect(classifyStorm(NaN)).toBeNull();
  });
  it.each([
    [20, 'TD'], [33.9, 'TD'], [34, 'TS'], [63, 'TS'],
    [64, '1'], [82, '1'], [83, '2'], [95, '2'], [96, '3'], [112, '3'], [113, '4'], [136, '4'], [137, '5'], [180, '5'],
  ])('%s kt → %s', (kt, code) => {
    expect(classifyStorm(kt, 20, -80)?.code).toBe(code);
  });
  it('names a major storm after its basin', () => {
    expect(classifyStorm(100, 25, -80)?.full).toBe('Category 3 Hurricane');
    expect(classifyStorm(100, 20, 130)?.full).toBe('Category 3 Typhoon');
    expect(classifyStorm(100, -15, 70)?.full).toBe('Category 3 Cyclone');
  });
  it('keeps weak storms generic', () => {
    expect(classifyStorm(45, 20, 130)?.full).toBe('Tropical Storm');
  });
});

describe('helpers', () => {
  it('basinName', () => {
    expect(basinName(15, -60)).toBe('Hurricane');
    expect(basinName(15, 170)).toBe('Typhoon');
    expect(basinName(15, 185 - 360 + 360)).toBe('Hurricane'); // 185°E is east of the date line
  });
  it('fmtWind shows knots and km/h', () => { expect(fmtWind(100)).toBe('100 kt (185 km/h)'); });
  it('stormOf only classifies storms', () => {
    expect(stormOf({ type: 'tectonic', wind_kts: 100, lat: 0, lon: 0 })).toBeNull();
    expect(stormOf({ type: 'storm', wind_kts: 100, lat: 20, lon: -80 })?.code).toBe('3');
  });
});
