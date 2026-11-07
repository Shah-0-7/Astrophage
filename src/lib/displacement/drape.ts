/** Pure helpers for the measured Topo view: sampling terrain, painting the displacement texture, reading a probe. */
import type { BBox, HeightGrid } from '@/lib/terrain';
import { fringeColor, losColor, type RGB } from './colors';
import { valueAt, type DisplacementField } from './field';

export type DrapeMode = 'continuous' | 'fringe';

/** Bilinear elevation (m) at a lon/lat; null outside the grid. */
export function heightAt(g: HeightGrid, lon: number, lat: number): number | null {
  const [w, s, e, n] = g.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const fx = Math.min(g.nx - 1, Math.max(0, ((lon - w) / (e - w)) * g.nx - 0.5));
  const fy = Math.min(g.ny - 1, Math.max(0, ((n - lat) / (n - s)) * g.ny - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1);
  const ax = fx - x0, ay = fy - y0, h = g.heights;
  return h[y0 * g.nx + x0] * (1 - ax) * (1 - ay) + h[y0 * g.nx + x1] * ax * (1 - ay) + h[y1 * g.nx + x0] * (1 - ax) * ay + h[y1 * g.nx + x1] * ax * ay;
}

/** A flat grid over a box, for when elevation could not be loaded. */
export function flatGrid(bbox: BBox, nx = 48, ny = 48): HeightGrid {
  return { nx, ny, bbox, heights: new Float32Array(nx * ny), min: 0, max: 0 };
}

/** Coherence 0–1 at a lon/lat, or null when the grid carries none. */
export function coherenceAt(f: DisplacementField, lon: number, lat: number): number | null {
  if (!f.coh) return null;
  const [w, s, e, n] = f.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const i = Math.min(f.nx - 1, Math.floor(((lon - w) / (e - w)) * f.nx));
  const j = Math.min(f.ny - 1, Math.floor(((n - lat) / (n - s)) * f.ny));
  return f.coh[j * f.nx + i] / 255;
}

export interface DrapeOptions {
  mode: DrapeMode;
  /** value (cm) at which the continuous scale saturates */
  limit: number;
  /** 0–1: how strongly the measurement covers the terrain colour */
  opacity: number;
  /** 0–1 coherence floor; pixels below it are left as bare terrain. Ignored when the grid has no coherence. */
  minCoherence: number;
}

/** Base terrain colour: a quiet dark ramp so the measured colours are what stands out. */
export function terrainTint(h: number, min: number, max: number): RGB {
  const t = max > min ? Math.max(0, Math.min(1, (h - min) / (max - min))) : 0.3;
  const v = 0.26 + 0.3 * t;
  return [v * 0.95, v, v * 0.92];
}

/** RGBA bytes (nx × ny, row 0 = north) for the texture draped on the terrain. Returns how many pixels are measured. */
export function paintDrape(f: DisplacementField, terrain: HeightGrid, o: DrapeOptions): { rgba: Uint8Array; shown: number } {
  const [w, s, e, n] = f.bbox;
  const rgba = new Uint8Array(f.nx * f.ny * 4);
  let shown = 0;
  for (let j = 0; j < f.ny; j++) {
    const lat = n - ((j + 0.5) / f.ny) * (n - s);
    for (let i = 0; i < f.nx; i++) {
      const lon = w + ((i + 0.5) / f.nx) * (e - w);
      const k = j * f.nx + i;
      const h = heightAt(terrain, lon, lat) ?? terrain.min;
      let c = terrainTint(h, terrain.min, terrain.max);
      const v = f.cm[k];
      const coherent = !f.coh || f.coh[k] / 255 >= o.minCoherence;
      if (!Number.isNaN(v) && coherent) {
        const m = o.mode === 'fringe' ? fringeColor(v) : losColor(v, o.limit);
        c = [c[0] + (m[0] - c[0]) * o.opacity, c[1] + (m[1] - c[1]) * o.opacity, c[2] + (m[2] - c[2]) * o.opacity];
        shown++;
      }
      rgba[k * 4] = Math.round(c[0] * 255); rgba[k * 4 + 1] = Math.round(c[1] * 255); rgba[k * 4 + 2] = Math.round(c[2] * 255); rgba[k * 4 + 3] = 255;
    }
  }
  return { rgba, shown };
}

export interface Probe { lon: number; lat: number; elevation: number | null; los: number | null; coherence: number | null }

export function probeAt(f: DisplacementField | null, terrain: HeightGrid, lon: number, lat: number): Probe {
  return { lon, lat, elevation: heightAt(terrain, lon, lat), los: f ? valueAt(f, lon, lat) : null, coherence: f ? coherenceAt(f, lon, lat) : null };
}
