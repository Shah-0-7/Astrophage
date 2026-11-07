import { describe, expect, it } from 'vitest';
import { coherenceAt, flatGrid, heightAt, paintDrape, probeAt } from '@/lib/displacement/drape';
import type { DisplacementField } from '@/lib/displacement/field';
import type { HeightGrid } from '@/lib/terrain';

const bbox: [number, number, number, number] = [10, 20, 12, 22];
const field = (cm: number[], coh?: number[]): DisplacementField => ({
  id: 'x', maturity: 'BETA', track: 1, frame: 2, direction: 'A', reference: 0, secondary: 1, bbox, nx: 2, ny: 2,
  cm: Float32Array.from(cm), coh: coh ? Uint8Array.from(coh) : undefined,
});
const ramp: HeightGrid = { nx: 2, ny: 2, bbox, heights: Float32Array.from([0, 100, 0, 100]), min: 0, max: 100 };

describe('drape helpers', () => {
  it('interpolates elevation and rejects points outside', () => {
    expect(heightAt(ramp, 11, 21)).toBeCloseTo(50, 5);
    expect(heightAt(ramp, 9, 21)).toBeNull();
    expect(heightAt(flatGrid(bbox), 11, 21)).toBe(0);
  });
  it('reads coherence only when the grid carries it', () => {
    expect(coherenceAt(field([0, 0, 0, 0]), 10.5, 21.5)).toBeNull();
    expect(coherenceAt(field([0, 0, 0, 0], [255, 0, 0, 0]), 10.5, 21.5)).toBeCloseTo(1, 5); // north-west cell
  });
  it('paints measured pixels, leaves no-data and low coherence as bare terrain', () => {
    const f = field([10, NaN, 10, 10], [255, 255, 10, 255]);
    const { rgba, shown } = paintDrape(f, ramp, { mode: 'continuous', limit: 10, opacity: 1, minCoherence: 0.5 });
    expect(shown).toBe(2);                 // NaN and the 10/255 pixel are skipped
    expect(rgba[0]).toBeGreaterThan(200);  // NW pixel: saturated toward-satellite red
    expect(rgba[4]).toBeLessThan(160);     // NE pixel: bare terrain tint (tint is dark by design)
    expect(rgba[3]).toBe(255);
  });
  it('probe combines elevation and measurement', () => {
    const p = probeAt(field([5, 5, 5, 5]), ramp, 11, 21);
    expect(p.los).toBeCloseTo(5, 5);
    expect(p.elevation).toBeCloseTo(50, 5);
    expect(probeAt(null, ramp, 11, 21).los).toBeNull();
  });
});
