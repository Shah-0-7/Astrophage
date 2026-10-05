/**
 * /api/sentinel – Copernicus / ESA Sentinel-1 SLC Swath Proxy
 * Queries the Copernicus Open Access Hub OData API for recent
 * Sentinel-1 SLC acquisitions and returns footprint polygons.
 *
 * Docs: https://scihub.copernicus.eu/dhus/odata/v1/
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SentinelProperties, UnifiedFeature } from '@/lib/types';

const SCIHUB_BASE = 'https://scihub.copernicus.eu/dhus/odata/v1';

// Note: Copernicus Hub requires OAuth2 credentials for full access.
// Without COPERNICUS_USER / COPERNICUS_PASS env vars, we fall back
// to the open API subset (no auth needed for basic searches).
const authHeader = (): HeadersInit => {
  const user = process.env.COPERNICUS_USER;
  const pass = process.env.COPERNICUS_PASS;
  if (!user || !pass) return {};
  return { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '3');

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().replace('T', ' ').slice(0, 19);

  const filter = `substringof('SLC',Name) and IngestionDate gt datetime'${sinceStr}'`;
  const url = `${SCIHUB_BASE}/Products?$filter=${encodeURIComponent(filter)}&$top=50&$format=json`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...authHeader() },
      next: { revalidate: 1800 },
    });

    if (!res.ok) throw new Error(`Copernicus returned ${res.status}`);
    const data = await res.json();
    const products: any[] = data?.d?.results ?? [];

    const features: UnifiedFeature[] = products.map((p: any) => {
      // Parse footprint WKT polygon from product metadata
      const footprintStr: string = p.ContentDate?.Start ?? '';
      const sizeKm2 = parseFloat(p.Size ?? '0') / 1e6;

      const props: SentinelProperties = {
        product_id:   p.Id ?? p.Name,
        acquisition:  p.ContentDate?.Start ?? new Date().toISOString(),
        orbit_dir:    (p.orbitdirection ?? 'ASC').toUpperCase() as 'ASC' | 'DESC',
        track:        parseInt(p.relativeorbitnumber ?? '0'),
        polarisation: p.polarisationmode ?? 'IW',
        swath_km2:    sizeKm2,
      };

      // Parse the footprint GML/WKT to a GeoJSON polygon
      // (footprint is in WKT POLYGON format from OData)
      const wkt: string = p.footprint ?? 'POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))';
      const coords = parseWKTPolygon(wkt);

      return {
        id:       `sentinel-${p.Id}`,
        source:   'sentinel' as const,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
        properties: props,
      };
    });

    return NextResponse.json({ type: 'sentinel', ts: Date.now(), features }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[/api/sentinel]', err);
    return NextResponse.json({ type: 'sentinel', ts: Date.now(), features: [] });
  }
}

/** Parse a simple WKT POLYGON string to a GeoJSON coordinate ring */
function parseWKTPolygon(wkt: string): [number, number][] {
  const inner = wkt.match(/POLYGON\s*\(\(([^)]+)\)/i)?.[1] ?? '';
  return inner.split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return [lng, lat] as [number, number];
  });
}
