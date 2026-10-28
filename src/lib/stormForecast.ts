/**
 * stormForecast – a rough projection of where a tropical cyclone is heading, from its own recent track.
 *
 * This is NOT an official forecast. It carries the storm forward on the motion measured over the last day
 * or so (speed, heading, and any steady turning), then checks the projected path against land. Real
 * NHC / JTWC products use steering-flow models and forecaster judgement, and will differ, especially when a
 * storm is about to recurve or stall. The UI always says so.
 */

const R = 6371;
const D2R = Math.PI / 180;
const H = 3_600_000;

export interface TrackPoint { lon: number; lat: number; time: number }
export interface Motion { speedKmh: number; bearing: number; turnPer12h: number }
export interface ForecastPoint { hours: number; lon: number; lat: number; radiusKm: number; land: boolean }
export interface Landfall { hours: number; lon: number; lat: number }
export interface StormForecast {
  motion: Motion;
  /** Hourly projected positions, hour 0 = the current position. */
  path: { lon: number; lat: number; radiusKm: number }[];
  /** The 12-hourly points the cone is labelled at. */
  points: ForecastPoint[];
  onLand: boolean;
  landfall: Landfall | null;
  /** First hour at which the edge of the uncertainty cone reaches land (null if it never does within the horizon). */
  coneLandHours: number | null;
  horizonHours: number;
}

/**
 * Cone radius by forecast hour, in nautical miles. Shaped after the average official-forecast track errors the
 * NHC publishes for its cone (roughly 26 nm at 12 h growing to ~90 nm at 72 h), then widened by 1.6× because
 * this projection is cruder than an official forecast. The factor is a judgement, not a fitted value.
 */
const NHC_NM: [number, number][] = [[0, 0], [12, 26], [24, 39], [36, 53], [48, 62], [60, 75], [72, 88]];
const WIDEN = 1.6;
const NM_TO_KM = 1.852;

export const HORIZON_HOURS = 72;

export function coneRadiusKm(hours: number): number {
  const h = Math.max(0, Math.min(HORIZON_HOURS, hours));
  for (let i = 1; i < NHC_NM.length; i++) {
    if (h <= NHC_NM[i][0]) {
      const [h0, r0] = NHC_NM[i - 1], [h1, r1] = NHC_NM[i];
      return (r0 + ((r1 - r0) * (h - h0)) / (h1 - h0)) * NM_TO_KM * WIDEN;
    }
  }
  return NHC_NM[NHC_NM.length - 1][1] * NM_TO_KM * WIDEN;
}

export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function destination(lon: number, lat: number, bearing: number, km: number): [number, number] {
  const d = km / R, b = bearing * D2R, p1 = lat * D2R, l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((((l2 / D2R) + 540) % 360) - 180), p2 / D2R];
}

const angDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Speed, heading and turn rate over the last ~day. Returns null when the track can't support one. */
export function motionFromTrack(track: TrackPoint[], current: TrackPoint): Motion | null {
  const past = track.filter(p => Number.isFinite(p.time) && current.time - p.time >= 3 * H && current.time - p.time <= 48 * H)
    .sort((a, b) => a.time - b.time);
  if (!past.length) return null;
  // The reference fix closest to 24 h back gives a stable velocity.
  const ref = past.reduce((best, p) => (Math.abs(current.time - p.time - 24 * H) < Math.abs(current.time - best.time - 24 * H) ? p : best));
  const hours = (current.time - ref.time) / H;
  const km = distanceKm(ref.lon, ref.lat, current.lon, current.lat);
  const speedKmh = km / hours;
  if (!Number.isFinite(speedKmh) || speedKmh < 3) return null;      // stalled: direction is meaningless
  if (speedKmh > 90) return null;                                    // implausible: bad fix
  const bearing = bearingDeg(ref.lon, ref.lat, current.lon, current.lat);

  // Turn rate: compare the heading of the older leg with the newer one, if the track is long enough.
  let turn = 0;
  const older = past.filter(p => p.time < ref.time && ref.time - p.time >= 3 * H);
  if (older.length) {
    const o = older[0];
    const legH = (ref.time - o.time) / H;
    const b0 = bearingDeg(o.lon, o.lat, ref.lon, ref.lat);
    const raw = (angDiff(b0, bearing) / ((legH + hours) / 2)) * 12;  // degrees per 12 h
    turn = Math.max(-15, Math.min(15, raw)) * 0.5;                   // halved: turning is the least reliable signal
  }
  return { speedKmh: Math.min(speedKmh, 80), bearing, turnPer12h: turn };
}

/**
 * Project the storm forward `HORIZON_HOURS`. `isLand` answers whether a coordinate is on land.
 * Returns null when there is no usable motion (no timestamped track, or the storm has stalled).
 */
export function forecastStorm(track: TrackPoint[], current: TrackPoint, isLand: (lon: number, lat: number) => boolean): StormForecast | null {
  const motion = motionFromTrack(track, current);
  if (!motion) return null;

  const path: StormForecast['path'] = [{ lon: current.lon, lat: current.lat, radiusKm: 0 }];
  let lon = current.lon, lat = current.lat, bearing = motion.bearing;
  for (let h = 1; h <= HORIZON_HOURS; h++) {
    bearing = (bearing + motion.turnPer12h / 12 + 360) % 360;
    [lon, lat] = destination(lon, lat, bearing, motion.speedKmh);
    if (Math.abs(lat) > 85) break;
    path.push({ lon, lat, radiusKm: coneRadiusKm(h) });
  }

  const onLand = isLand(current.lon, current.lat);
  let landfall: Landfall | null = null;
  let coneLandHours: number | null = null;
  let prevLand = onLand;
  path.forEach((p, h) => {
    if (h === 0) return;
    const l = isLand(p.lon, p.lat);
    if (!landfall && !prevLand && l) landfall = { hours: h, lon: p.lon, lat: p.lat };
    prevLand = l;
    if (coneLandHours == null && !onLand) {
      for (let a = 0; a < 360; a += 45) {
        const [ex, ey] = destination(p.lon, p.lat, a, p.radiusKm);
        if (isLand(ex, ey)) { coneLandHours = h; break; }
      }
    }
  });

  const points: ForecastPoint[] = [12, 24, 36, 48, 60, 72].filter(h => path[h]).map(h => ({
    hours: h, lon: path[h].lon, lat: path[h].lat, radiusKm: path[h].radiusKm, land: isLand(path[h].lon, path[h].lat),
  }));
  return { motion, path, points, onLand, landfall, coneLandHours, horizonHours: path.length - 1 };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

/** Build the timestamped track the forecast needs from a storm event. Points without a time are dropped. */
export function trackPointsOf(e: { track?: [number, number, number?][]; lon: number; lat: number; time: number }): { track: TrackPoint[]; current: TrackPoint } {
  const track = (e.track ?? []).flatMap(p => (typeof p[2] === 'number' && Number.isFinite(p[2]) ? [{ lon: p[0], lat: p[1], time: p[2] }] : []));
  return { track, current: { lon: e.lon, lat: e.lat, time: e.time } };
}
