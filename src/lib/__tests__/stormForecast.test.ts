import { describe, it, expect } from 'vitest';
import { forecastStorm, motionFromTrack, coneRadiusKm, destination, distanceKm, bearingDeg, compass, trackPointsOf } from '@/lib/stormForecast';

const H = 3_600_000, T0 = Date.UTC(2026, 9, 20);

/** A storm that has moved due west at `kmh` for 30 hours, one fix every 6 h. */
function westbound(kmh: number, lat = 20) {
  const pts = [];
  let lon = -50;
  for (let h = 0; h <= 30; h += 6) {
    pts.push({ lon, lat, time: T0 + h * H });
    [lon] = destination(lon, lat, 270, kmh * 6);
  }
  const current = pts.pop()!;
  return { track: pts, current };
}

describe('geometry helpers', () => {
  it('destination and distance agree', () => {
    const [lo, la] = destination(10, 20, 90, 500);
    expect(distanceKm(10, 20, lo, la)).toBeCloseTo(500, 0);
    expect(bearingDeg(10, 20, lo, la)).toBeGreaterThan(85);
    expect(bearingDeg(10, 20, lo, la)).toBeLessThan(95);
  });
  it('compass names', () => { expect(compass(0)).toBe('N'); expect(compass(281)).toBe('W'); expect(compass(300)).toBe('WNW'); });
});

describe('coneRadiusKm', () => {
  it('grows with time and is wider than the official-error table', () => {
    expect(coneRadiusKm(0)).toBe(0);
    expect(coneRadiusKm(12)).toBeCloseTo(26 * 1.852 * 1.6, 1);
    expect(coneRadiusKm(72)).toBeGreaterThan(coneRadiusKm(48));
    expect(coneRadiusKm(200)).toBe(coneRadiusKm(72));
  });
});

describe('motionFromTrack', () => {
  it('measures speed and heading', () => {
    const { track, current } = westbound(20);
    const m = motionFromTrack(track, current)!;
    expect(m.speedKmh).toBeGreaterThan(18);
    expect(m.speedKmh).toBeLessThan(22);
    expect(m.bearing).toBeGreaterThan(265);
    expect(m.bearing).toBeLessThan(285);
  });
  it('gives up without timestamps, or when stalled, or on a bad fix', () => {
    expect(motionFromTrack([], { lon: 0, lat: 0, time: T0 })).toBeNull();
    const stalled = [{ lon: 0, lat: 10, time: T0 }];
    expect(motionFromTrack(stalled, { lon: 0.01, lat: 10, time: T0 + 24 * H })).toBeNull();
    expect(motionFromTrack([{ lon: 0, lat: 10, time: T0 }], { lon: 40, lat: 10, time: T0 + 24 * H })).toBeNull();
  });
});

describe('forecastStorm', () => {
  it('projects 72 hours ahead along the heading', () => {
    const { track, current } = westbound(20);
    const f = forecastStorm(track, current, () => false)!;
    expect(f.horizonHours).toBe(72);
    expect(f.path[0]).toMatchObject({ lon: current.lon, lat: current.lat });
    expect(f.path[72].lon).toBeLessThan(current.lon - 10);
    expect(f.landfall).toBeNull();
    expect(f.points.map(p => p.hours)).toEqual([12, 24, 36, 48, 60, 72]);
  });
  it('finds landfall where the path first reaches land', () => {
    const { track, current } = westbound(20);
    const landWestOf = current.lon - 7;           // land begins ~7° west
    const f = forecastStorm(track, current, lon => lon < landWestOf)!;
    expect(f.landfall).not.toBeNull();
    expect(f.landfall!.hours).toBeGreaterThan(30);
    expect(f.landfall!.hours).toBeLessThan(45);
    expect(f.coneLandHours!).toBeLessThanOrEqual(f.landfall!.hours);
  });
  it('reports a storm already over land without a landfall', () => {
    const { track, current } = westbound(20);
    const f = forecastStorm(track, current, () => true)!;
    expect(f.onLand).toBe(true);
    expect(f.landfall).toBeNull();
  });
  it('returns null with no timestamped track', () => {
    expect(forecastStorm([], { lon: 0, lat: 0, time: T0 }, () => false)).toBeNull();
  });
});

describe('trackPointsOf', () => {
  it('drops points without a time', () => {
    const r = trackPointsOf({ lon: 1, lat: 2, time: 5, track: [[0, 0], [1, 1, 3]] });
    expect(r.track).toEqual([{ lon: 1, lat: 1, time: 3 }]);
    expect(r.current).toEqual({ lon: 1, lat: 2, time: 5 });
  });
});
