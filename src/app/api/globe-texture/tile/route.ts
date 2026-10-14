/**
 * /api/globe-texture/tile – NASA GIBS WMTS Tile Proxy
 * =====================================================
 * Serves individual 256×256 WMTS tiles from NASA GIBS so the globe
 * can load progressively sharper imagery as the camera zooms in.
 *
 * GIBS WMTS tile URL pattern (EPSG:4326):
 *   https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/
 *     GoogleMapsCompatible_Level{maxZoom}/{z}/{y}/{x}.jpg
 *
 * Usage:
 *   GET /api/globe-texture/tile?layer=satellite|terrain&z=Z&x=X&y=Y
 *
 * Cache: 7 days (tile imagery doesn't change)
 */

import { NextRequest, NextResponse } from 'next/server';

const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/**
 * BlueMarble_ShadedRelief_Bathymetry uses the '500m' TileMatrixSet
 * in GIBS EPSG:4326 (not GoogleMapsCompatible).
 * Grid dimensions: tilesX = 2^z + 1, tilesY = ceil((2^z + 1) / 2)
 *   z=0: 2 cols × 1 row
 *   z=1: 3 cols × 2 rows
 *   z=2: 5 cols × 3 rows
 *   z=3: 9 cols × 5 rows
 *   z=4: 17 cols × 9 rows
 *   z=5: 33 cols × 17 rows
 */
const TILE_LAYER_MAP: Record<string, { layer: string; matrixSet: string; maxZ: number }> = {
  satellite: { layer: 'BlueMarble_ShadedRelief_Bathymetry', matrixSet: '500m', maxZ: 5 },
  terrain:   { layer: 'BlueMarble_ShadedRelief_Bathymetry', matrixSet: '500m', maxZ: 5 },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('layer') ?? 'satellite';
  const z    = parseInt(searchParams.get('z') ?? '0', 10);
  const x    = parseInt(searchParams.get('x') ?? '0', 10);
  const y    = parseInt(searchParams.get('y') ?? '0', 10);

  const cfg = TILE_LAYER_MAP[type];
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown layer' }, { status: 400 });
  }

  // Clamp to available zoom levels
  const clampedZ = Math.min(z, cfg.maxZ);

  // GIBS WMTS tile URL (EPSG:4326, 500m TileMatrixSet)
  // URL format: /{layer}/default/{matrixSet}/{z}/{y}/{x}.jpg
  const tileUrl =
    `${GIBS_WMTS}/${cfg.layer}/default/${cfg.matrixSet}` +
    `/${clampedZ}/${y}/${x}.jpg`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const upstream = await fetch(tileUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'NISAR-SAR-Telemetry-Platform/1.0 (+https://github.com)',
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      console.warn(`[/api/globe-texture/tile] GIBS ${upstream.status} z=${z} x=${x} y=${y}`);
      return new NextResponse(null, { status: 404 });
    }

    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        'X-Globe-Tile': `${z}/${x}/${y}`,
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[/api/globe-texture/tile] fetch failed: ${msg}`);
    return new NextResponse(null, { status: 503 });
  }
}
