import { describe, expect, it } from 'vitest';
import { boxAround, boxSizeKm, chooseZoom, decodeTerrarium, heightGridFromTiles, latToY, lonToX, tilesForBBox, type TileImage } from '@/lib/terrain';

/** A tile whose elevation is a function of the pixel position. */
function tile(f: (x: number, y: number) => number): TileImage {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = Math.round((f(x, y) + 32768) * 256); // metres -> Terrarium (1/256 m steps)
    const o = (y * 256 + x) * 4;
    data[o] = Math.floor(v / 65536); data[o + 1] = Math.floor(v / 256) % 256; data[o + 2] = v % 256; data[o + 3] = 255;
  }
  return { data, width: 256, height: 256 };
}

describe('terrarium decoding', () => {
  it('decodes known values', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);          // sea level
    expect(decodeTerrarium(128, 100, 0)).toBe(100);
    expect(decodeTerrarium(127, 255, 128)).toBeCloseTo(-0.5, 5);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
  });
});

describe('tile maths', () => {
  it('matches Web Mercator', () => {
    expect(lonToX(0, 1)).toBe(1); expect(lonToX(-180, 5)).toBe(0); expect(lonToX(180, 5)).toBe(32);
    expect(latToY(0, 3)).toBeCloseTo(4, 9);
    expect(latToY(85, 3)).toBeLessThan(0.1);
  });
  it('lists the tiles covering a box', () => {
    const t = tilesForBBox([86.0, 27.5, 87.0, 28.5], 8);
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.every(k => k.z === 8)).toBe(true);
    expect(new Set(t.map(k => `${k.x}/${k.y}`)).size).toBe(t.length);
  });
  it('picks a zoom that keeps the tile count bounded', () => {
    const bb = boxAround(86.5, 28, 120);
    const z = chooseZoom(bb, 9);
    expect(tilesForBBox(bb, z).length).toBeLessThanOrEqual(9);
    expect(z).toBeGreaterThan(5);
    expect(chooseZoom([-180, -85, 180, 85], 4)).toBeLessThanOrEqual(2);
  });
  it('sizes a box in kilometres', () => {
    const { widthKm, heightKm } = boxSizeKm(boxAround(0, 0, 50));
    expect(widthKm).toBeCloseTo(100, 0); expect(heightKm).toBeCloseTo(100, 0);
    expect(boxSizeKm(boxAround(0, 60, 50)).widthKm).toBeCloseTo(100, 0); // longitude shrinks with latitude, the box compensates
  });
});

describe('heightGridFromTiles', () => {
  const z = 8, bbox: [number, number, number, number] = [86.0, 27.9, 86.2, 28.1];
  const tiles = tilesForBBox(bbox, z);
  it('samples a ramp that rises to the east', () => {
    const map = new Map(tiles.map(k => [`${k.z}/${k.x}/${k.y}`, tile(x => 1000 + x * 10)]));
    const g = heightGridFromTiles(bbox, 16, 16, z, map);
    expect(g.nx).toBe(16);
    expect(g.heights[0 * 16 + 15]).toBeGreaterThan(g.heights[0 * 16 + 0]);   // east higher
    expect(g.min).toBeLessThan(g.max);
  });
  it('puts north at row 0', () => {
    const map = new Map(tiles.map(k => [`${k.z}/${k.x}/${k.y}`, tile((_, y) => 500 + y * 5)])); // rises to the south (y grows southward)
    const g = heightGridFromTiles(bbox, 16, 16, z, map);
    expect(g.heights[15 * 16 + 8]).toBeGreaterThan(g.heights[0 * 16 + 8]);
  });
  it('fills cells with missing tiles instead of returning NaN', () => {
    const g = heightGridFromTiles(bbox, 8, 8, z, new Map());
    expect(Array.from(g.heights).every(Number.isFinite)).toBe(true);
    expect(g.min).toBe(0); expect(g.max).toBe(0);
  });
  it('is exact for flat terrain', () => {
    const map = new Map(tiles.map(k => [`${k.z}/${k.x}/${k.y}`, tile(() => 4200.5)]));
    const g = heightGridFromTiles(bbox, 10, 10, z, map);
    expect(g.min).toBeCloseTo(4200.5, 2); expect(g.max).toBeCloseTo(4200.5, 2);
  });
});
