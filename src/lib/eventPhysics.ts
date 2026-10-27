/**
 * eventPhysics – first-order estimates derived from an event's magnitude and depth.
 *
 * Nothing here is a measurement. Surface displacement is only *measured* by InSAR / GNSS, which the platform has
 * not ingested yet, so for earthquakes we estimate it from published empirical scaling relations and always label
 * the result as an estimate:
 *
 *   Wells & Coppersmith (1994), all slip types, M 4.8–8.1:
 *     log10 SRL = -3.22 + 0.69 M      surface rupture length (km)
 *     log10 RLD = -2.44 + 0.59 M      subsurface rupture length (km)
 *     log10 RW  = -1.01 + 0.32 M      downdip rupture width (km)
 *     log10 RA  = -3.49 + 0.91 M      rupture area (km²)
 *     log10 MD  = -5.46 + 0.82 M      maximum surface displacement (m)
 *     log10 AD  = -4.80 + 0.69 M      average surface displacement (m)
 *   Hanks & Kanamori (1979): M0 = 10^(1.5 M + 9.05) N·m, average slip D = M0 / (μ A), μ = 33 GPa.
 */
import type { GlobalEvent } from './globalEvents';

export type DisplacementKind =
  | 'surface-rupture'   // slip likely reaches the surface – max surface displacement estimated
  | 'buried-slip'       // rupture stays underground – average fault slip estimated, surface effect smaller
  | 'negligible'        // too small or too deep to deform the surface measurably
  | 'unknown';          // no basis for an estimate (needs InSAR / GNSS)

export interface Rupture {
  lengthKm: number;
  widthKm: number;
  areaKm2: number;
  avgSlipCm: number;
  surfaceLengthKm: number | null;
  maxSurfaceCm: number | null;
  avgSurfaceCm: number | null;
}

export interface DisplacementEstimate {
  kind: DisplacementKind;
  /** Headline number in centimetres (null when unknown). */
  cm: number | null;
  /** Short label such as "≈ 42 CM" for compact UI. */
  label: string;
  /** One-line explanation, always says it is an estimate. */
  note: string;
  rupture: Rupture | null;
}

const MU = 33e9; // Pa

export function ruptureFromMagnitude(mag: number): Rupture {
  const l = Math.pow(10, -2.44 + 0.59 * mag);
  const w = Math.pow(10, -1.01 + 0.32 * mag);
  const a = Math.pow(10, -3.49 + 0.91 * mag);
  const m0 = Math.pow(10, 1.5 * mag + 9.05);
  const avgSlip = m0 / (MU * a * 1e6); // m
  const surfaceLike = mag >= 5.6;
  return {
    lengthKm: l,
    widthKm: w,
    areaKm2: a,
    avgSlipCm: avgSlip * 100,
    surfaceLengthKm: surfaceLike ? Math.pow(10, -3.22 + 0.69 * mag) : null,
    maxSurfaceCm: surfaceLike ? Math.pow(10, -5.46 + 0.82 * mag) * 100 : null,
    avgSurfaceCm: surfaceLike ? Math.pow(10, -4.8 + 0.69 * mag) * 100 : null,
  };
}

export function fmtCm(cm: number): string {
  if (cm < 0.1) return '< 0.1';
  if (cm < 10) return cm.toFixed(1);
  return String(Math.round(cm));
}

/** Human formatting that switches to metres for large values. */
export function fmtDisp(cm: number): string {
  if (cm >= 100) return `${(cm / 100).toFixed(cm >= 1000 ? 0 : 1)} M`;
  return `${fmtCm(cm)} CM`;
}

export function estimateDisplacement(e: Pick<GlobalEvent, 'type' | 'magnitude' | 'depth' | 'displacement_cm'>): DisplacementEstimate {
  // A measured value always wins.
  if (e.displacement_cm != null) {
    return { kind: 'unknown', cm: e.displacement_cm, label: `${e.displacement_cm} CM`, note: 'Measured displacement.', rupture: null };
  }
  const seismic = e.type === 'tectonic' || e.type === 'induced_seismicity' || e.type === 'mining';
  if (!seismic || e.magnitude == null) {
    const why =
      e.type === 'storm' ? 'Tropical cyclones do not displace the ground; their impact is wind, storm surge and flooding.' :
      e.type === 'volcanic' ? 'Volcano deformation needs InSAR / GNSS; no estimate from VEI alone.' :
      e.type === 'subsidence' ? 'Subsidence is a long-term rate, measured by InSAR; not derivable here.' :
      e.type === 'landslide' ? 'Landslide movement needs InSAR / optical offset tracking.' :
      e.type === 'cryosphere' ? 'Ice motion needs SAR offset tracking.' :
      'No magnitude available to estimate from.';
    return { kind: 'unknown', cm: null, label: e.type === 'storm' ? 'N/A' : 'NEEDS INSAR', note: why, rupture: null };
  }

  const mag = e.magnitude;
  const depth = e.depth ?? 10;
  const r = ruptureFromMagnitude(mag);

  if (mag < 4) {
    return { kind: 'negligible', cm: 0.1, label: '< 0.1 CM', note: `Estimate: M${mag.toFixed(1)} is too small to deform the surface measurably.`, rupture: r };
  }
  if (depth > 70) {
    return {
      kind: 'negligible', cm: 0.1, label: '< 0.1 CM',
      note: `Estimate: source depth ${Math.round(depth)} km is far below the crust that deforms the surface; fault slip of about ${r.avgSlipCm < 1 ? 'under 1' : Math.round(r.avgSlipCm)} cm is not expressed at the surface.`,
      rupture: r,
    };
  }
  if (mag >= 6 && depth <= 30 && r.maxSurfaceCm != null) {
    return {
      kind: 'surface-rupture', cm: r.maxSurfaceCm, label: `≈ ${fmtDisp(r.maxSurfaceCm)}`,
      note: `Estimate (Wells & Coppersmith 1994): maximum surface displacement if the rupture breaks the surface; average about ${fmtDisp(r.avgSurfaceCm ?? r.maxSurfaceCm / 2)}. Factor-of-two uncertainty.`,
      rupture: r,
    };
  }
  // Rupture buried: report average fault slip, attenuated for how deep it sits relative to its width.
  const atten = Math.exp(-Math.max(0, depth - r.widthKm / 2) / Math.max(4, r.widthKm * 1.2));
  const surf = Math.max(0.1, r.avgSlipCm * atten);
  return {
    kind: 'buried-slip', cm: surf, label: `≈ ${fmtDisp(surf)}`,
    note: `Estimate: average fault slip is about ${fmtDisp(r.avgSlipCm)} on a ${r.lengthKm.toFixed(0)} × ${r.widthKm.toFixed(0)} km patch at ${Math.round(depth)} km depth, so the expected surface motion is smaller (about ${fmtDisp(surf)}). Only InSAR / GNSS can confirm.`,
    rupture: r,
  };
}

export function depthClass(depthKm: number): string {
  if (depthKm < 70) return 'shallow';
  if (depthKm < 300) return 'intermediate-depth';
  return 'deep-focus';
}

export function magClass(mag: number): string {
  if (mag < 3) return 'micro';
  if (mag < 4) return 'minor';
  if (mag < 5) return 'light';
  if (mag < 6) return 'moderate';
  if (mag < 7) return 'strong';
  if (mag < 8) return 'major';
  return 'great';
}

export const MMI_WORDS = ['', 'not felt', 'weak', 'weak', 'light', 'moderate', 'strong', 'very strong', 'severe', 'violent', 'extreme', 'extreme', 'extreme'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export function roman(n: number): string { return ROMAN[Math.max(1, Math.min(12, Math.round(n)))] ?? String(n); }
