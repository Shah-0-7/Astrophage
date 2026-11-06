/**
 * /api/nisar/granules – real NISAR scene footprints from NASA CMR, as GeoJSON for the map layer.
 *   ?bbox=w,s,e,n   (required, at most 60° wide / 40° tall: zoom in for more)
 *   &days=14        (1–60, default 14)
 *   &products=GCOV,GUNW  (default: all)
 */
import { clientKey, rateLimit } from '@/lib/rateLimit';
import { ALL_PRODUCTS, NISAR_ARCHIVE_START, PRODUCTS } from '@/lib/nisar/catalog';
import { queryScenes } from '@/lib/nisar/service';
import type { NisarProduct } from '@/lib/nisar/types';

const MAX_FEATURES = 300;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' };
const reply = (body: unknown, status = 200, h: Record<string, string> = headers) => new Response(JSON.stringify(body), { status, headers: h });

export async function GET(req: Request) {
  const limit = rateLimit(`nisar:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return reply({ error: 'Too many requests' }, 429, { 'Content-Type': 'application/json', 'Retry-After': String(limit.retryAfterSec) });

  const sp = new URL(req.url).searchParams;
  const bb = (sp.get('bbox') ?? '').split(',').map(Number);
  if (bb.length !== 4 || bb.some(v => !Number.isFinite(v))) return reply({ error: 'bbox=west,south,east,north is required' }, 400, { 'Content-Type': 'application/json' });
  const [w, s, e, n] = bb;
  const width = e >= w ? e - w : e + 360 - w;
  if (width > 60 || n - s > 40 || n <= s) return reply({ error: 'Area too large. Zoom in to load NISAR scenes.', tooLarge: true }, 400, { 'Content-Type': 'application/json' });

  const days = Math.min(60, Math.max(1, Math.round(Number(sp.get('days') ?? 14)) || 14));
  const wanted = (sp.get('products') ?? '').split(',').filter((p): p is NisarProduct => (ALL_PRODUCTS as string[]).includes(p));
  const from = Math.max(NISAR_ARCHIVE_START, Date.now() - days * 86_400_000);

  const r = await queryScenes({ bbox: [w, s, e, n], products: wanted.length ? wanted : undefined, from, limit: MAX_FEATURES });
  if (!r.ok) return reply({ type: 'FeatureCollection', features: [], meta: { ok: false, count: 0, truncated: false, error: r.error } });

  const features = r.scenes.map(sc => ({
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [sc.ring] },
    properties: {
      id: sc.id, product: sc.product, productName: PRODUCTS[sc.product].name, insar: PRODUCTS[sc.product].insar, maturity: sc.maturity,
      start: sc.start, end: sc.end, cycle: sc.cycle ?? null, track: sc.track ?? null, direction: sc.direction ?? null, frame: sc.frame ?? null,
      pairReference: sc.pair?.reference ?? null, pairSecondary: sc.pair?.secondary ?? null, metadataUrl: sc.metadataUrl,
    },
  }));
  return reply({ type: 'FeatureCollection', features, meta: { ok: true, count: features.length, total: r.hits, truncated: r.hits > features.length, days } });
}
