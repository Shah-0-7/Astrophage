/**
 * NISAR scene metadata as published by NASA's CMR (the catalogue behind ASF DAAC / Earthdata Search).
 * These are *records of what NISAR observed* (footprint, time, product), not the pixel data itself.
 */

export type NisarProduct = 'RSLC' | 'RIFG' | 'ROFF' | 'RUNW' | 'GSLC' | 'GOFF' | 'GCOV' | 'GUNW' | 'SME2';
/** PROVISIONAL = calibrated and partially validated (acquisitions from 2026-06-17); BETA = pre-calibration (Oct 2025–Jan 2026). */
export type NisarMaturity = 'PROVISIONAL' | 'BETA';

export interface NisarScene {
  /** CMR GranuleUR (the file name without extension). */
  id: string;
  /** CMR concept id, when present (e.g. G123-ASF). */
  conceptId?: string;
  /** CMR collection short name, e.g. NISAR_L2_GUNW_PROVISIONAL_V1. */
  collection: string;
  product: NisarProduct;
  maturity: NisarMaturity;
  /** CMR temporal extent, epoch ms. For a single acquisition this is minutes long; for an interferogram it may span the pair. */
  start: number;
  end: number;
  cycle?: number;
  /** Relative orbit number. */
  track?: number;
  direction?: 'A' | 'D';
  frame?: number;
  /** Interferogram products only: the two acquisitions combined, epoch ms. `source` says where the dates came from. */
  pair?: { reference: number; secondary: number; source: 'name' | 'metadata' };
  /** Footprint outer ring as [lon, lat]. */
  ring: [number, number][];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Download URL (needs a free Earthdata Login). */
  dataUrl?: string;
  sizeMb?: number;
  /** Public CMR metadata page for the granule. */
  metadataUrl: string;
}

export interface NisarCoverage {
  /** Scenes (any product) whose footprint contains the point. */
  total: number;
  firstSeen: number | null;
  lastSeen: number | null;
  /** Scenes acquired after the event time. */
  afterEvent: number;
  byProduct: Partial<Record<NisarProduct, number>>;
}
