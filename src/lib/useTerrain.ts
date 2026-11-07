'use client';

import { useEffect, useMemo, useState } from 'react';
import { chooseZoom, heightGridFromTiles, tileId, tilesForBBox, type BBox, type HeightGrid, type TileImage } from '@/lib/terrain';

export type TerrainState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; grid: HeightGrid };

const cache = new Map<string, TileImage | null>();

async function loadTile(z: number, x: number, y: number): Promise<TileImage | null> {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(`/api/terrain?z=${z}&x=${x}&y=${y}`);
    if (!res.ok) throw new Error(String(res.status));
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const t: TileImage = { data: img.data, width: img.width, height: img.height };
    cache.set(key, t);
    return t;
  } catch { return null; } // not cached: a later visit retries
}

/** Real elevation for a lon/lat box, as an n×n height grid (metres). */
export function useTerrain(bbox: BBox | null, size = 128): TerrainState {
  const [state, setState] = useState<TerrainState>({ status: 'loading' });
  const key = useMemo(() => (bbox ? bbox.map(v => v.toFixed(4)).join(',') : ''), [bbox]);
  useEffect(() => {
    if (!bbox) return;
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      const z = chooseZoom(bbox, 12, 11);
      const keys = tilesForBBox(bbox, z);
      const loaded = await Promise.all(keys.map(k => loadTile(k.z, k.x, k.y)));
      if (!alive) return;
      const tiles = new Map<string, TileImage>();
      keys.forEach((k, i) => { const t = loaded[i]; if (t) tiles.set(tileId(k), t); });
      if (tiles.size === 0) { setState({ status: 'failed' }); return; }
      const [w, s, e, n] = bbox;
      // Square-ish cells on the ground
      const ratio = ((e - w) * Math.cos(((s + n) / 2) * Math.PI / 180)) / (n - s);
      const nx = ratio >= 1 ? size : Math.max(8, Math.round(size * ratio));
      const ny = ratio >= 1 ? Math.max(8, Math.round(size / ratio)) : size;
      setState({ status: 'ready', grid: heightGridFromTiles(bbox, nx, ny, z, tiles) });
    })();
    return () => { alive = false; };
  }, [key, size]);
  return state;
}
