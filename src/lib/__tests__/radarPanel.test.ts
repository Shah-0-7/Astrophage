import { describe, expect, it } from 'vitest';
import { featurePoint, featureToGlobalEvent } from '@/components/observatory/radar-panel';
import type { UnifiedFeature } from '@/lib/types';

const quake = {
  id: 'us1', source: 'seismic', geometry: { type: 'Point', coordinates: [58.6, 29.7] },
  properties: { place: 'Bam, Iran', magnitude: 6.7, depth_km: 3, event_time: '2026-11-11T10:00:00.000Z', url: 'https://example.org/q' },
} as unknown as UnifiedFeature;

describe('radar panel helpers', () => {
  it('reads the position and time of a feed earthquake', () => {
    expect(featurePoint(quake)).toEqual({ lat: 29.7, lon: 58.6, time: Date.parse('2026-11-11T10:00:00.000Z') });
  });

  it('returns null when the timestamp is unusable', () => {
    const bad = { ...quake, properties: { ...(quake.properties as object), event_time: 'not a date' } } as unknown as UnifiedFeature;
    expect(featurePoint(bad)).toBeNull();
  });

  it('describes an earthquake in the directory shape for the 3D view', () => {
    const e = featureToGlobalEvent(quake);
    expect(e).toMatchObject({ type: 'tectonic', title: 'Bam, Iran', lat: 29.7, lon: 58.6, magnitude: 6.7, depth: 3, source_url: 'https://example.org/q' });
  });

  it('does not offer the 3D view for non-earthquakes', () => {
    const v = { ...quake, source: 'volcanism', properties: { name: 'Etna', last_eruption: '2026-11-01T00:00:00Z' } } as unknown as UnifiedFeature;
    expect(featurePoint(v)).not.toBeNull();
    expect(featureToGlobalEvent(v)).toBeNull();
  });
});
