/**
 * /api/globe-texture – NASA GIBS WMS + WMTS Proxy
 * =================================================
 * Proxies NASA GIBS requests to avoid CORS restrictions.
 *
 * WMS flat texture (for initial load):
 *   GET /api/globe-texture?layer=satellite|terrain
 *
 * WMTS tile endpoint (for zoom-level crisp detail):
 *   GET /api/globe-texture/tile?layer=satellite|terrain&z=Z&x=X&y=Y
 *
 * Layer mapping:
 *   satellite → BlueMarble_ShadedRelief_Bathymetry  (ocean + land color)
 *   terrain   → BlueMarble_ShadedRelief_Bathymetry  (same — already has topo)
 *
 * NOTE: BlueMarble_ShadedRelief_Bathymetry is used for BOTH modes because
 * it includes proper ocean/bathymetry colour (deep blue oceans with depth
 * gradients) unlike BlueMarble_NextGeneration which has black oceans.
 *
 * Server-side cache: max-age 24 h, stale-while-revalidate 1 h.
 */

import { NextRequest, NextResponse } from 'next/server';

const GIBS_BASE =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/**
 * BlueMarble_ShadedRelief_Bathymetry:
 *   - Includes full ocean bathymetry colour (no black oceans)
 *   - Land surface with shaded relief
 *   - Available at all zoom levels via WMS + WMTS
 */
const LAYER_MAP: Record<string, string> = {
  satellite: 'BlueMarble_ShadedRelief_Bathymetry',
  terrain:   'BlueMarble_ShadedRelief_Bathymetry',
};

/** 4096 × 2048 – full equirectangular at max GIBS WMS resolution; stays
 *  sharp when the camera zooms close. The server caches the response for
 *  24 h so this doesn't hit GIBS on every page load. */
const W = 4096, H = 2048;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type  = searchParams.get('layer') ?? 'satellite';
  const layer = LAYER_MAP[type];

  if (!layer) {
    return NextResponse.json({ error: 'Unknown layer' }, { status: 400 });
  }

  // Always JPEG – no alpha channel → no black-ocean artefact from
  // transparent pixels being composited onto a dark background.
  const fmt = 'image/jpeg';

  const wmsUrl = `${GIBS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1` +
    `&LAYERS=${layer}&SRS=EPSG:4326&BBOX=-180,-90,180,90` +
    `&WIDTH=${W}&HEIGHT=${H}&FORMAT=${encodeURIComponent(fmt)}`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  try {
    const upstream = await fetch(wmsUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'NISAR-SAR-Telemetry-Platform/1.0 (+https://github.com)',
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      console.warn(`[/api/globe-texture] GIBS ${upstream.status} for layer=${type}`);
      return new NextResponse(null, { status: 503 });
    }

    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': fmt,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'X-Globe-Layer': type,
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[/api/globe-texture] fetch failed (${type}): ${msg}`);
    return new NextResponse(null, { status: 503 });
  }
}
