/**
 * stormScale – tropical-cyclone intensity from maximum sustained wind.
 * Saffir–Simpson thresholds (1-minute sustained wind, knots); the regional name follows the basin.
 */

export interface StormClass {
  code: string;     // short badge: TD, TS, 1–5
  label: string;    // "Category 3", "Tropical Storm"
  name: string;     // "Hurricane" | "Typhoon" | "Cyclone" | "Tropical Storm" | "Tropical Depression"
  full: string;     // "Category 3 Hurricane"
  tone: 'good' | 'warn' | 'bad';
  band: string;     // wind range of the class
}

export const KT_TO_KMH = 1.852;
export const MPH_TO_KT = 0.868976;
export const kmhToKt = (v: number) => v / KT_TO_KMH;

/** Basin word for a major tropical cyclone, from where it is. */
export function basinName(lat: number, lon: number): 'Hurricane' | 'Typhoon' | 'Cyclone' {
  if (lat >= 0 && (lon <= -20 || lon >= 180)) return 'Hurricane';          // North Atlantic, NE Pacific, central Pacific
  if (lat >= 0 && lon >= 100 && lon < 180) return 'Typhoon';              // NW Pacific
  return 'Cyclone';                                                        // Indian Ocean, South Pacific, Australia
}

export function classifyStorm(windKt: number | null | undefined, lat = 0, lon = 0): StormClass | null {
  if (windKt == null || !isFinite(windKt) || windKt <= 0) return null;
  const big = basinName(lat, lon);
  if (windKt < 34) return { code: 'TD', label: 'Tropical Depression', name: 'Tropical Depression', full: 'Tropical Depression', tone: 'good', band: '< 34 kt' };
  if (windKt < 64) return { code: 'TS', label: 'Tropical Storm', name: 'Tropical Storm', full: 'Tropical Storm', tone: 'good', band: '34–63 kt' };
  const cat = windKt < 83 ? 1 : windKt < 96 ? 2 : windKt < 113 ? 3 : windKt < 137 ? 4 : 5;
  const band = ['64–82 kt', '83–95 kt', '96–112 kt', '113–136 kt', '≥ 137 kt'][cat - 1];
  return { code: String(cat), label: `Category ${cat}`, name: big, full: `Category ${cat} ${big}`, tone: cat >= 3 ? 'bad' : 'warn', band };
}

export const fmtWind = (kt: number) => `${Math.round(kt)} kt (${Math.round(kt * KT_TO_KMH)} km/h)`;

/** Intensity class of a storm event (null for other event types or when the wind is unknown). */
export function stormOf(e: { type: string; wind_kts?: number | null; lat: number; lon: number }): StormClass | null {
  return e.type === 'storm' ? classifyStorm(e.wind_kts, e.lat, e.lon) : null;
}
