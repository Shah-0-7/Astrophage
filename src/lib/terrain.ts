/**
 * Terrain from public "Terrarium" elevation tiles (Web Mercator, 256 px PNGs, elevation = R*256 + G + B/256 - 32768 metres).
 * Pure helpers: fetching and PNG decoding live in useTerrain.ts.
 */

export type BBox = [number, number, number, number]; // west, south, east, north
export const TILE = 256;

export const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export function latToY(lat: number, z: number): number {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

export interface TileKey { z: number; x: number; y: number }
export const tileId = (t: TileKey) => `${t.z}/${t.x}/${t.y}`;

/** Tiles covering the box at zoom z. */
export function tilesForBBox([w, s, e, n]: BBox, z: number): TileKey[] {
  const max = 2 ** z - 1;
  const x0 = Math.max(0, Math.floor(lonToX(w, z))), x1 = Math.min(max, Math.floor(lonToX(e, z)));
  const y0 = Math.max(0, Math.floor(latToY(n, z))), y1 = Math.min(max, Math.floor(latToY(s, z)));
  const out: TileKey[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

/** The highest zoom (≤ maxZoom) that keeps the tile count at or under maxTiles. */
export function chooseZoom(bbox: BBox, maxTiles = 12, maxZoom = 11): number {
  for (let z = maxZoom; z > 0; z--) if (tilesForBBox(bbox, z).length <= maxTiles) return z;
  return 1;
}

export interface TileImage { data: Uint8ClampedArray; width: number; height: number }
export interface HeightGrid { nx: number; ny: number; bbox: BBox; heights: Float32Array; min: number; max: number }

/**
 * Resample tiles onto a regular lon/lat grid (row 0 = north), bilinear in Mercator pixel space.
 * Missing tiles give NaN there; those cells are filled with the lowest known elevation so the mesh stays closed.
 */
export function heightGridFromTiles(bbox: BBox, nx: number, ny: number, z: number, tiles: Map<string, TileImage>): HeightGrid {
  const [w, s, e, n] = bbox;
  const heights = new Float32Array(nx * ny);
  const px = (t: TileImage, ix: number, iy: number) => {
    const o = (iy * t.width + ix) * 4;
    return decodeTerrarium(t.data[o], t.data[o + 1], t.data[o + 2]);
  };
  const at = (gx: number, gy: number): number => { // global pixel coordinates at zoom z
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const t = tiles.get(`${z}/${tx}/${ty}`);
    if (!t) return NaN;
    return px(t, Math.min(t.width - 1, Math.max(0, Math.floor(gx - tx * TILE))), Math.min(t.height - 1, Math.max(0, Math.floor(gy - ty * TILE))));
  };
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j++) {
    const lat = n - ((j + 0.5) / ny) * (n - s);
    const gy = latToY(lat, z) * TILE;
    for (let i = 0; i < nx; i++) {
      const lon = w + ((i + 0.5) / nx) * (e - w);
      const gx = lonToX(lon, z) * TILE;
      const fx = gx - 0.5, fy = gy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const v00 = at(x0, y0), v10 = at(x0 + 1, y0), v01 = at(x0, y0 + 1), v11 = at(x0 + 1, y0 + 1);
      const known = [v00, v10, v01, v11].filter(v => !Number.isNaN(v));
      let h: number;
      if (known.length === 4) h = v00 * (1 - ax) * (1 - ay) + v10 * ax * (1 - ay) + v01 * (1 - ax) * ay + v11 * ax * ay;
      else if (known.length) h = known.reduce((a, b) => a + b, 0) / known.length;
      else h = NaN;
      heights[j * nx + i] = h;
      if (!Number.isNaN(h)) { if (h < min) min = h; if (h > max) max = h; }
    }
  }
  if (!Number.isFinite(min)) return { nx, ny, bbox, heights: heights.fill(0), min: 0, max: 0 };
  for (let i = 0; i < heights.length; i++) if (Number.isNaN(heights[i])) heights[i] = min;
  return { nx, ny, bbox, heights, min, max };
}

/** Ground size of a lon/lat box in km (width at the middle latitude, height). */
export function boxSizeKm([w, s, e, n]: BBox): { widthKm: number; heightKm: number } {
  const lat = (s + n) / 2;
  return { widthKm: (e - w) * 111.32 * Math.cos((lat * Math.PI) / 180), heightKm: (n - s) * 110.57 };
}

/** A square-ish box of about `radiusKm` around a point. */
export function boxAround(lon: number, lat: number, radiusKm: number): BBox {
  const dLat = radiusKm / 110.57, dLon = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [Math.max(-180, lon - dLon), Math.max(-90, lat - dLat), Math.min(180, lon + dLon), Math.min(90, lat + dLat)];
}
