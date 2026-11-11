import { describe, expect, it } from 'vitest';
import { applyRadarFilter, DEFAULT_RADAR_FILTER, eventsInPeriod, inPeriod, periodOf, radarEvents } from '@/lib/radarEvents';
import type { GlobalEvent } from '@/lib/globalEvents';

const ev = (id: string, type: GlobalEvent['type'], time: number, magnitude: number | null, title = id): GlobalEvent => ({
  id, type, cause: 'natural', title, lat: 0, lon: 0, time, magnitude, depth: null, displacement_cm: null, source: 'USGS', source_url: '', sources: ['USGS'],
});
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const events = [ev('a', 'tectonic', T0, 7.1), ev('b', 'tectonic', T0 + 10 * DAY, 5.2), ev('c', 'volcanic', T0 + 20 * DAY, 2), ev('d', 'landslide', T0 + 30 * DAY, null, 'Slide near Kyiv')];
const all = (progress: number) => ({ windowId: 'all' as const, anchor: T0 + 30 * DAY, progress });

describe('radar events', () => {
  it('shows nothing past the scrubber and everything at the end', () => {
    expect(eventsInPeriod(events, all(1)).map(e => e.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(eventsInPeriod(events, all(0.5)).map(e => e.id).sort()).toEqual(['a', 'b']);
  });

  it('names the period the scrubber selects', () => {
    expect(periodOf(events, all(1))).toEqual({ start: T0, end: T0 + 30 * DAY });
    expect(periodOf(events, all(0.5)).end).toBe(T0 + 15 * DAY);
  });

  it('filters by type, magnitude and text the way the Events page does', () => {
    expect(applyRadarFilter(events, { ...DEFAULT_RADAR_FILTER, types: ['tectonic'] }).map(e => e.id)).toEqual(['a', 'b']);
    expect(applyRadarFilter(events, { ...DEFAULT_RADAR_FILTER, magMin: 6 }).map(e => e.id)).toEqual(['a']);
    expect(applyRadarFilter(events, { ...DEFAULT_RADAR_FILTER, search: 'kyiv' }).map(e => e.id)).toEqual(['d']);
  });

  it('lists the newest first', () => {
    expect(radarEvents(events, DEFAULT_RADAR_FILTER, all(1)).map(e => e.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('says whether an event is inside the period', () => {
    expect(inPeriod(events[3], events, all(0.5))).toBe(false);
    expect(inPeriod(events[3], events, all(1))).toBe(true);
  });
});
