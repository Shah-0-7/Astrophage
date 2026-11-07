/**
 * Measured ground-motion grid derived from a NISAR GUNW interferogram, in a compact wire format.
 *
 * Values are line-of-sight (LOS) change in centimetres between the reference and secondary acquisitions, positive toward
 * the satellite, on a regular longitude/latitude grid (row 0 = north edge). int16 at 0.1 cm steps keeps a 256×256 grid
 * near 175 KB as JSON; -32768 marks "no data" (low coherence, water, unwrapping failures, outside the frame).
 *
 * LOS is not vertical motion: a single geometry cannot separate vertical from horizontal.
 */

export const FIELD_VERSION = 1;
export const SCALE_CM = 0.1;
export const NODATA = -32768;
export const MAX_DIM = 256;
export const MAX_ABS_CM = 3276;

export type BBox = [number, number, number, number];

export interface FieldMeta {
  id: string;
  /** Data maturity of the source product. */
  maturity: string;
  track: number | null;
  frame: number | null;
  direction: 'A' | 'D' | null;
  /** epoch ms of the two acquisitions */
  reference: number;
  secondary: number;
  bbox: BBox;
  nx: number;
  ny: number;
}

export interface FieldWire extends FieldMeta {
  v: typeof FIELD_VERSION;
  scale: number;
  /** base64 int16 little-endian, nx*ny, row-major from the north-west corner */
  los: string;
  /** optional base64 uint8 coherence (0–255), same layout */
  coh?: string;
  /** free-text caveats from the processor (reference level, corrections applied, …) */
  notes?: string;
}

export interface DisplacementField extends FieldMeta {
  cm: Float32Array; // NaN = no data
  coh?: Uint8Array;
  notes?: string;
}

// ── base64 ────────────────────────────────────────────────────

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeField(f: DisplacementField): FieldWire {
  const n = f.nx * f.ny;
  if (f.cm.length !== n) throw new Error('cm length does not match nx*ny');
  const q = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = f.cm[i];
    q[i] = Number.isFinite(v) && Math.abs(v) <= MAX_ABS_CM ? Math.round(v / SCALE_CM) : NODATA;
  }
  const wire: FieldWire = {
    v: FIELD_VERSION, id: f.id, maturity: f.maturity, track: f.track, frame: f.frame, direction: f.direction,
    reference: f.reference, secondary: f.secondary, bbox: f.bbox, nx: f.nx, ny: f.ny, scale: SCALE_CM,
    los: toB64(new Uint8Array(q.buffer, q.byteOffset, q.byteLength)),
  };
  if (f.coh) wire.coh = toB64(f.coh);
  if (f.notes) wire.notes = f.notes;
  return wire;
}

/** Strict validation of untrusted input (the ingest endpoint). Returns the typed wire object or a reason it was refused. */
export function validateWire(x: unknown): { ok: true; wire: FieldWire } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!x || typeof x !== 'object') return bad('Body must be a JSON object.');
  const w = x as Record<string, unknown>;
  if (w.v !== FIELD_VERSION) return bad(`Unsupported version (expected ${FIELD_VERSION}).`);
  if (typeof w.id !== 'string' || !/^[A-Za-z0-9_.\-]{3,200}$/.test(w.id)) return bad('id must be 3–200 characters of letters, digits, _ . -');
  if (typeof w.maturity !== 'string' || !/^[A-Z]{3,20}$/.test(w.maturity)) return bad('maturity must be upper-case letters (e.g. PROVISIONAL).');
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(w.nx, 2, MAX_DIM) || !int(w.ny, 2, MAX_DIM)) return bad(`nx and ny must be integers from 2 to ${MAX_DIM}.`);
  if (!int(w.reference, 1.7e12, 4.1e12) || !int(w.secondary, 1.7e12, 4.1e12)) return bad('reference and secondary must be epoch milliseconds (2023–2099).');
  if ((w.secondary as number) <= (w.reference as number)) return bad('secondary must be after reference.');
  const bb = w.bbox;
  if (!Array.isArray(bb) || bb.length !== 4 || bb.some(v => typeof v !== 'number' || !Number.isFinite(v))) return bad('bbox must be [west, south, east, north].');
  const [W, S, E, N] = bb as number[];
  if (W < -180 || E > 180 || S < -90 || N > 90 || E <= W || N <= S) return bad('bbox is out of range or empty (antimeridian-crossing grids are not supported).');
  if (E - W > 10 || N - S > 10) return bad('bbox larger than 10 degrees.');
  if (w.scale !== SCALE_CM) return bad(`scale must be ${SCALE_CM}.`);
  const n = (w.nx as number) * (w.ny as number);
  if (typeof w.los !== 'string' || w.los.length !== Math.ceil((n * 2) / 3) * 4) return bad('los has the wrong length for nx*ny int16 values.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(w.los)) return bad('los is not base64.');
  if (w.coh !== undefined && (typeof w.coh !== 'string' || w.coh.length !== Math.ceil(n / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(w.coh))) return bad('coh has the wrong length or is not base64.');
  const opt = (v: unknown, ok: (v: unknown) => boolean) => v === null || v === undefined || ok(v);
  if (!opt(w.track, v => int(v, 0, 999)) || !opt(w.frame, v => int(v, 0, 999))) return bad('track and frame must be small integers or null.');
  if (!opt(w.direction, v => v === 'A' || v === 'D')) return bad('direction must be "A", "D" or null.');
  if (w.notes !== undefined && (typeof w.notes !== 'string' || w.notes.length > 2000)) return bad('notes must be a string under 2000 characters.');
  return {
    ok: true,
    wire: {
      v: FIELD_VERSION, id: w.id, maturity: w.maturity, track: (w.track as number | null | undefined) ?? null, frame: (w.frame as number | null | undefined) ?? null,
      direction: (w.direction as 'A' | 'D' | null | undefined) ?? null, reference: w.reference as number, secondary: w.secondary as number,
      bbox: [W, S, E, N], nx: w.nx as number, ny: w.ny as number, scale: SCALE_CM, los: w.los, coh: w.coh as string | undefined, notes: w.notes as string | undefined,
    },
  };
}

export function decodeField(w: FieldWire): DisplacementField {
  const bytes = fromB64(w.los);
  const n = w.nx * w.ny;
  if (bytes.length !== n * 2) throw new Error('los length mismatch');
  const q = new Int16Array(bytes.buffer, bytes.byteOffset, n);
  const cm = new Float32Array(n);
  for (let i = 0; i < n; i++) cm[i] = q[i] === NODATA ? NaN : q[i] * w.scale;
  return { id: w.id, maturity: w.maturity, track: w.track, frame: w.frame, direction: w.direction, reference: w.reference, secondary: w.secondary, bbox: w.bbox, nx: w.nx, ny: w.ny, cm, coh: w.coh ? fromB64(w.coh) : undefined, notes: w.notes };
}

// ── Reading values ────────────────────────────────────────────

/** Bilinear-free nearest lookup at a longitude/latitude; null outside the grid or on no-data. */
export function valueAt(f: DisplacementField, lon: number, lat: number): number | null {
  const [w, s, e, n] = f.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const i = Math.min(f.nx - 1, Math.floor(((lon - w) / (e - w)) * f.nx));
  const j = Math.min(f.ny - 1, Math.floor(((n - lat) / (n - s)) * f.ny));
  const v = f.cm[j * f.nx + i];
  return Number.isNaN(v) ? null : v;
}

export interface FieldStats { count: number; coverage: number; min: number; max: number; p2: number; p98: number; maxAbs: number }

export function fieldStats(f: DisplacementField): FieldStats | null {
  const vals: number[] = [];
  for (const v of f.cm) if (!Number.isNaN(v)) vals.push(v);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  return { count: vals.length, coverage: vals.length / f.cm.length, min: vals[0], max: vals[vals.length - 1], p2: q(0.02), p98: q(0.98), maxAbs: Math.max(Math.abs(vals[0]), Math.abs(vals[vals.length - 1])) };
}

/** L-band wavelength in cm (NISAR: ~1.2575 GHz). One full fringe is half of this in LOS motion. */
export const L_BAND_WAVELENGTH_CM = 23.84;
export const FRINGE_CM = L_BAND_WAVELENGTH_CM / 2;

export function metaOf(w: FieldMeta): FieldMeta {
  return { id: w.id, maturity: w.maturity, track: w.track, frame: w.frame, direction: w.direction, reference: w.reference, secondary: w.secondary, bbox: w.bbox, nx: w.nx, ny: w.ny };
}
