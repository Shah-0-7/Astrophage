import { describe, it, expect } from 'vitest';
import { matchesRule, findAlerts, newRule, stormCategory, shouldNotify, ALERT_WINDOW_MS } from '@/lib/watchlist';
import type { GlobalEvent } from '@/lib/globalEvents';

const NOW = Date.UTC(2026, 9, 28, 12);
const ev = (o: Partial<GlobalEvent>): GlobalEvent => ({
  id: 'x', type: 'tectonic', cause: 'natural', title: 'T', lat: 35.7, lon: 139.7, time: NOW - 3_600_000,
  magnitude: 6, depth: 10, displacement_cm: null, source: 'USGS', source_url: '', sources: ['USGS'], ...o,
});

describe('matchesRule', () => {
  it('applies magnitude only to non-storms and rejects unmeasured events', () => {
    const r = newRule({ minMagnitude: 6.5 });
    expect(matchesRule(r, ev({ magnitude: 6.4 }))).toBe(false);
    expect(matchesRule(r, ev({ magnitude: 6.5 }))).toBe(true);
    expect(matchesRule(r, ev({ magnitude: null }))).toBe(false);
    expect(matchesRule(r, ev({ type: 'storm', magnitude: null, wind_kts: 40, lat: 20, lon: -60 }))).toBe(true);
  });
  it('uses Saffir–Simpson category for storms ("above Category 3" = min 4)', () => {
    const r = newRule({ types: ['storm'], minCategory: 4 });
    const storm = (kt: number) => ev({ type: 'storm', magnitude: null, wind_kts: kt, lat: 20, lon: -60 });
    expect(matchesRule(r, storm(112))).toBe(false); // Cat 3
    expect(matchesRule(r, storm(113))).toBe(true);  // Cat 4
    expect(matchesRule(r, storm(140))).toBe(true);
    expect(matchesRule(r, storm(50))).toBe(false);
    expect(stormCategory(storm(50))).toBe(0);
  });
  it('filters by type, region and distance from a place', () => {
    expect(matchesRule(newRule({ types: ['volcanic'] }), ev({}))).toBe(false);
    expect(matchesRule(newRule({ region: 'east_asia' }), ev({}))).toBe(true);
    expect(matchesRule(newRule({ region: 'europe' }), ev({}))).toBe(false);
    const near = newRule({ at: { lat: 35.69, lon: 139.75, name: 'Tokyo', radiusKm: 100 } });
    expect(matchesRule(near, ev({}))).toBe(true);
    expect(matchesRule(near, ev({ lat: 34.7, lon: 135.5 }))).toBe(false); // Osaka, ~400 km
  });
});

describe('findAlerts', () => {
  const rule = newRule({ minMagnitude: 5 });
  it('returns only recent matches, newest first', () => {
    const a = ev({ id: 'a', time: NOW - 5 * 3_600_000 });
    const b = ev({ id: 'b', time: NOW - 1 * 3_600_000 });
    const old = ev({ id: 'old', time: NOW - ALERT_WINDOW_MS - 1 });
    const small = ev({ id: 's', magnitude: 3 });
    expect(findAlerts([rule], [a, old, small, b], NOW).map(x => x.event.id)).toEqual(['b', 'a']);
  });
  it('returns nothing without rules', () => { expect(findAlerts([], [ev({})], NOW)).toEqual([]); });
});

describe('shouldNotify', () => {
  it('skips events from well before the rule existed', () => {
    const r = { ...newRule({}), createdAt: NOW };
    expect(shouldNotify(r, ev({ time: NOW - 10 * 3_600_000 }))).toBe(false);
    expect(shouldNotify(r, ev({ time: NOW + 60_000 }))).toBe(true);
  });
});
