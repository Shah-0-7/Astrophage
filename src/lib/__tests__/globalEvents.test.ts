import { describe, expect, it } from 'vitest';
import { deduplicateEvents, eonetEventsFromJson, mergeStorms, type GlobalEvent } from '../globalEvents';

const base: GlobalEvent = {
  id: 'x', type: 'tectonic', cause: 'natural', title: 't', lat: 0, lon: 0, time: 1_700_000_000_000,
  magnitude: 5, depth: 10, displacement_cm: null, source: 'USGS', source_url: '', sources: ['USGS'],
};

describe('eonetEventsFromJson', () => {
  const json = {
    events: [
      { id: 'E1', title: 'Hurricane Rafael', link: 'u', categories: [{ id: 'severeStorms' }], geometry: [
        { type: 'Point', date: '2026-10-25T00:00:00Z', coordinates: [-84, 18], magnitudeValue: 70, magnitudeUnit: 'kts' },
        { type: 'Point', date: '2026-10-26T00:00:00Z', coordinates: [-85, 19], magnitudeValue: 100, magnitudeUnit: 'kts' },
      ] },
      { id: 'E2', title: 'Wildfire', categories: [{ id: 'wildfires' }], geometry: [{ type: 'Point', date: '2026-10-26T00:00:00Z', coordinates: [1, 1] }] },
      { id: 'E3', title: 'Etna', categories: [{ id: 'volcanoes' }], geometry: [
        { type: 'Point', date: '2026-10-24T00:00:00Z', coordinates: [15, 37] }, { type: 'Point', date: '2026-10-25T00:00:00Z', coordinates: [15, 37] } ] },
    ],
  };
  const out = eonetEventsFromJson(json);
  it('keeps one record per storm, at its latest position, with the earlier track', () => {
    const storms = out.filter(e => e.type === 'storm');
    expect(storms).toHaveLength(1);
    expect(storms[0]).toMatchObject({ lat: 19, lon: -85, wind_kts: 100 });
    expect(storms[0].track).toEqual([[-84, 18, Date.parse('2026-10-25T00:00:00Z')]]);
    expect(storms[0].id).toBe('eonet_E1');
  });
  it('skips categories it does not model instead of calling them tectonic', () => {
    expect(out.find(e => e.title === 'Wildfire')).toBeUndefined();
    expect(out.some(e => e.type === 'tectonic')).toBe(false);
  });
  it('keeps one volcano record per observation', () => { expect(out.filter(e => e.type === 'volcanic')).toHaveLength(2); });
  it('converts wind units', () => {
    const mph = eonetEventsFromJson({ events: [{ id: 'S', title: 'Storm', categories: [{ id: 'severeStorms' }], geometry: [{ type: 'Point', date: '2026-10-26T00:00:00Z', coordinates: [1, 1], magnitudeValue: 115, magnitudeUnit: 'mph' }] }] });
    expect(mph[0].wind_kts).toBeCloseTo(100, 0);
  });
  it('survives empty or malformed input', () => {
    expect(eonetEventsFromJson({})).toEqual([]);
    expect(eonetEventsFromJson({ events: [{ id: 'z', categories: [{ id: 'severeStorms' }], geometry: [{}] }] })).toEqual([]);
  });
});

describe('mergeStorms', () => {
  const eonet: GlobalEvent = { ...base, id: 'eonet_1', type: 'storm', title: 'Tropical Cyclone Arnab', source: 'NASA EONET', sources: ['NASA EONET'], magnitude: null, wind_kts: null, track: [[1, 1]], time: 1000 };
  const gdacs: GlobalEvent = { ...base, id: 'gdacs_TC_9', type: 'storm', title: 'Tropical Cyclone ARNAB', source: 'GDACS', sources: ['GDACS'], magnitude: null, wind_kts: 80, time: 2000 };
  it('merges the same storm from both feeds, keeping wind and track', () => {
    const merged = mergeStorms([eonet, gdacs, base]);
    const storms = merged.filter(e => e.type === 'storm');
    expect(storms).toHaveLength(1);
    expect(storms[0].sources.sort()).toEqual(['GDACS', 'NASA EONET']);
    expect(storms[0].wind_kts).toBe(80); expect(storms[0].track).toHaveLength(1);
    expect(merged).toContainEqual(base);
  });
  it('keeps different storms apart', () => {
    expect(mergeStorms([eonet, { ...gdacs, title: 'Tropical Cyclone Ula' }]).filter(e => e.type === 'storm')).toHaveLength(2);
  });
});

describe('deduplicateEvents', () => {
  it('merges the same quake reported twice nearby in space and time', () => {
    const a = { ...base, id: 'a' }, b = { ...base, id: 'b', source: 'EONET', sources: ['EONET'], lat: 0.1, time: base.time + 3_600_000 };
    expect(deduplicateEvents([a, b])).toHaveLength(1);
  });
  it('keeps distant events', () => {
    expect(deduplicateEvents([{ ...base, id: 'a' }, { ...base, id: 'b', lat: 30 }])).toHaveLength(2);
  });
});
