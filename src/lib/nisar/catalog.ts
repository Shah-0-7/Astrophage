import type { NisarMaturity, NisarProduct } from './types';

export interface ProductInfo { code: NisarProduct; level: 1 | 2 | 3; name: string; insar: boolean; note: string }

/** NISAR products as listed in the ASF NISAR Data User Guide. */
export const PRODUCTS: Record<NisarProduct, ProductInfo> = {
  RSLC: { code: 'RSLC', level: 1, name: 'Range-Doppler single look complex', insar: false, note: 'Complex radar image; the input to InSAR.' },
  RIFG: { code: 'RIFG', level: 1, name: 'Range-Doppler wrapped interferogram', insar: true, note: 'Phase difference between two passes, in radar geometry.' },
  ROFF: { code: 'ROFF', level: 1, name: 'Range-Doppler pixel offsets', insar: true, note: 'Pixel-tracking offsets between two passes.' },
  RUNW: { code: 'RUNW', level: 1, name: 'Range-Doppler unwrapped interferogram', insar: true, note: 'Unwrapped phase in radar geometry.' },
  GSLC: { code: 'GSLC', level: 2, name: 'Geocoded single look complex', insar: false, note: 'Complex radar image on a map grid.' },
  GOFF: { code: 'GOFF', level: 2, name: 'Geocoded pixel offsets', insar: true, note: 'Map-grid pixel offsets; used for large displacements (earthquake rupture, glaciers, landslides).' },
  GCOV: { code: 'GCOV', level: 2, name: 'Geocoded polarimetric covariance', insar: false, note: 'Backscatter on a map grid (not InSAR).' },
  GUNW: { code: 'GUNW', level: 2, name: 'Geocoded unwrapped interferogram', insar: true, note: 'Ground motion between two passes, on a map grid (80 m unwrapped, 20 m wrapped).' },
  SME2: { code: 'SME2', level: 3, name: 'Soil moisture', insar: false, note: 'Level-3 soil moisture.' },
};

export const MATURITIES: NisarMaturity[] = ['PROVISIONAL', 'BETA'];
export const INTERFEROGRAM_PRODUCTS: NisarProduct[] = (Object.values(PRODUCTS) as ProductInfo[]).filter(p => p.insar).map(p => p.code);
export const ALL_PRODUCTS = Object.keys(PRODUCTS) as NisarProduct[];

/** CMR collection short name, e.g. NISAR_L2_GUNW_PROVISIONAL_V1. */
export function collectionName(p: NisarProduct, m: NisarMaturity): string {
  return `NISAR_L${PRODUCTS[p].level}_${p}_${m}_V1`;
}

const SHORT = /^NISAR_L([123])_([A-Z0-9]{4})_(PROVISIONAL|BETA)_V\d+$/;
export function parseCollection(shortName: string): { product: NisarProduct; maturity: NisarMaturity } | null {
  const m = SHORT.exec(shortName);
  if (!m || !(m[2] in PRODUCTS)) return null;
  return { product: m[2] as NisarProduct, maturity: m[3] as NisarMaturity };
}

/** First NISAR science data in the public archive (BETA, 17 Oct 2025). Nothing earlier exists to search. */
export const NISAR_ARCHIVE_START = Date.UTC(2025, 9, 17);

export const NISAR_LINKS = {
  asfSearch: 'https://search.asf.alaska.edu/#/?dataset=NISAR',
  userGuide: 'https://nisar-docs.asf.alaska.edu/',
  operaDisp: 'https://www.earthdata.nasa.gov/data/projects/opera/dswx-s1',
};
