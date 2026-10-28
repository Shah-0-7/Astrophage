import { describe, expect, it } from 'vitest';
import { estimateDisplacement, ruptureFromMagnitude } from '../eventPhysics';

const quake = (magnitude: number, depth: number) => ({ type: 'tectonic' as const, magnitude, depth, displacement_cm: null });

describe('ruptureFromMagnitude (Wells & Coppersmith 1994)', () => {
  it('grows with magnitude', () => {
    const a = ruptureFromMagnitude(5), b = ruptureFromMagnitude(7);
    expect(b.areaKm2).toBeGreaterThan(a.areaKm2 * 20);
    expect(b.lengthKm).toBeGreaterThan(a.lengthKm);
  });
  it('gives plausible dimensions for M7', () => {
    const r = ruptureFromMagnitude(7);
    expect(r.lengthKm).toBeGreaterThan(30); expect(r.lengthKm).toBeLessThan(100);
  });
});

describe('estimateDisplacement', () => {
  it('prefers a measured value', () => {
    const d = estimateDisplacement({ ...quake(6, 10), displacement_cm: 12 });
    expect(d.cm).toBe(12); expect(d.note).toMatch(/measured/i);
  });
  it('small and deep quakes are negligible', () => {
    expect(estimateDisplacement(quake(3.5, 10)).kind).toBe('negligible');
    expect(estimateDisplacement(quake(4.9, 110)).kind).toBe('negligible');
  });
  it('large shallow quakes rupture the surface', () => {
    const d = estimateDisplacement(quake(7.2, 10));
    expect(d.kind).toBe('surface-rupture'); expect(d.cm!).toBeGreaterThan(50);
  });
  it('non-seismic events cannot be estimated', () => {
    expect(estimateDisplacement({ type: 'volcanic', magnitude: 3, depth: null, displacement_cm: null }).label).toBe('NEEDS INSAR');
  });
  it('storms are not applicable', () => {
    const d = estimateDisplacement({ type: 'storm', magnitude: null, depth: null, displacement_cm: null });
    expect(d.label).toBe('N/A'); expect(d.note).toMatch(/do not displace/);
  });
});
