/**
 * NASA OPERA DISP-S1: Sentinel-1 surface-displacement time series on a fixed frame grid, published through ASF DAAC.
 * Coverage (per NASA): the U.S. and territories, parts of Canada within 200 km of the border, and the mainland from the
 * southern U.S. border through Panama. Phase 1 covers July 2016 – December 2024. A NISAR-based DISP is planned.
 * These boxes are deliberately approximate; the ASF displacement portal is the authority on exact frames.
 */

const REGIONS: [number, number, number, number][] = [
  [-125, 7, -77, 53],     // contiguous U.S., Mexico, Central America, southern Canada
  [-170, 51, -130, 72],   // Alaska
  [-161, 18, -154, 23],   // Hawaii
  [-68, 17, -64, 19],     // Puerto Rico and U.S. Virgin Islands
];

export const OPERA_DISP_PHASE1 = { from: Date.UTC(2016, 6, 1), to: Date.UTC(2024, 11, 31, 23, 59, 59) };
export const OPERA_DISP_LINKS = {
  portal: 'https://displacement.asf.alaska.edu/',
  about: 'https://www.earthdata.nasa.gov/news/opera-project-releases-level-3-displacement-products',
};

export function inOperaDispRegion(lon: number, lat: number): boolean {
  return REGIONS.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
}

export type OperaFit = 'covered-period' | 'outside-period' | 'outside-region';
export function operaDispFit(lon: number, lat: number, time: number): OperaFit {
  if (!inOperaDispRegion(lon, lat)) return 'outside-region';
  return time >= OPERA_DISP_PHASE1.from && time <= OPERA_DISP_PHASE1.to ? 'covered-period' : 'outside-period';
}
