import { describe, it, expect } from 'vitest';
import { eventsToCSV, eventsToGeoJSON } from '@/lib/exportEvents';
import type { GlobalEvent } from '@/lib/globalEvents';

const base: GlobalEvent = {
  id: 'usgs-1', type: 'tectonic', cause: 'natural', title: 'M 6.1 - 10 km "NE" of Foo, Bar',
  lat: -12.5, lon: 170.25, time: Date.UTC(2026, 9, 1, 12, 30), magnitude: 6.1, depth: 10,
  displacement_cm: null, source: 'USGS', source_url: 'https://example.org/1', sources: ['USGS', 'GDACS'],
};

describe('eventsToCSV', () => {
  it('writes a header and quotes commas and quotes', () => {
    const csv = eventsToCSV([base]).split('\r\n');
    expect(csv[0]).toBe('id,type,title,time_utc,lat,lon,magnitude,depth_km,storm_category,wind_kts,pressure_hpa,cause,source,source_url');
    expect(csv[1]).toContain('"M 6.1 - 10 km ""NE"" of Foo, Bar"');
    expect(csv[1]).toContain('2026-10-01T12:30:00.000Z');
    expect(csv[1]).toContain('USGS + GDACS');
  });
  it('neutralises spreadsheet formulas in text but leaves negative numbers alone', () => {
    const csv = eventsToCSV([{ ...base, title: '=HYPERLINK("x")' }]).split('\r\n')[1];
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-12.5,');
  });
  it('adds storm category for storms', () => {
    const csv = eventsToCSV([{ ...base, type: 'storm', magnitude: null, wind_kts: 100, lat: 20, lon: -60 }]);
    expect(csv).toMatch(/Category 3/);
  });
  it('is just a header for no events', () => {
    expect(eventsToCSV([]).trim().split('\n')).toHaveLength(1);
  });
});

describe('eventsToGeoJSON', () => {
  it('puts [lon, lat] in geometry', () => {
    const g = eventsToGeoJSON([base]);
    expect(g.type).toBe('FeatureCollection');
    expect(g.features[0].geometry.coordinates).toEqual([170.25, -12.5]);
    expect(g.features[0].properties.magnitude).toBe(6.1);
  });
});
