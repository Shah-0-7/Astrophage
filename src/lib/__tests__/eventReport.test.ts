import { describe, expect, it } from 'vitest';
import { buildReport } from '../eventReport';
import type { GlobalEvent } from '../globalEvents';

const ev = (o: Partial<GlobalEvent>): GlobalEvent => ({
  id: 'e', type: 'tectonic', cause: 'natural', title: '100 km E of La Tirana, Chile', lat: -20.3, lon: -68.6, time: Date.UTC(2026, 9, 26, 5, 17),
  magnitude: 4.9, depth: 110, displacement_cm: null, source: 'USGS', source_url: 'u', sources: ['USGS'], ...o,
});
const src = [{ name: 'USGS', url: 'u', ok: true }];

describe('buildReport', () => {
  it('writes a quake summary with magnitude, depth, area and displacement', () => {
    const r = buildReport({ event: ev({}), sources: src });
    expect(r.summary).toMatch(/magnitude 4\.9/);
    expect(r.summary).toMatch(/110 km/);
    expect(r.summary).toMatch(/km²/);
    expect(r.summary).toMatch(/Surface displacement/);
    expect(r.facts.map(f => f.label)).toContain('Depth');
  });
  it('says plainly when PAGER has no assessment', () => {
    expect(buildReport({ event: ev({}), sources: src }).summary).toMatch(/not issued a PAGER/);
  });
  it('describes a storm with its category and wind, and no displacement figure', () => {
    const r = buildReport({ event: ev({ type: 'storm', title: 'Hurricane Rafael', lat: 19, lon: -85, magnitude: null, depth: null, wind_kts: 100, track: [[-84, 18]] }), sources: src });
    expect(r.summary).toMatch(/Category 3 Hurricane/);
    expect(r.summary).toMatch(/100 kt/);
    expect(r.summary).toMatch(/tracking north/);
    expect(r.facts.find(f => f.label === 'Category')?.tone).toBe('bad');
    expect(r.displacement.label).toBe('N/A');
  });
  it('does not invent a category when wind is missing', () => {
    const r = buildReport({ event: ev({ type: 'storm', magnitude: null, depth: null, wind_kts: null }), sources: src });
    expect(r.summary).toMatch(/do not report a wind speed/);
  });
  it('handles volcanoes without a VEI', () => {
    const r = buildReport({ event: ev({ type: 'volcanic', title: 'Etna', magnitude: null, depth: null }), sources: src });
    expect(r.summary).toMatch(/no explosivity/);
  });
});
