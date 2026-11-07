/**
 * /api/displacement – measured ground-motion grids from NISAR interferograms.
 *   ?lat=&lon=&time=   metadata of grids covering the point whose date pair spans the time (shortest pair first)
 *   ?id=               the grid itself (compact JSON, see src/lib/displacement/field.ts)
 * Grids are uploaded by tools/nisar-grid through /api/displacement/ingest.
 */
import { fail, json } from '@/lib/server/api';
import { findFields, getFieldBody } from '@/lib/server/displacementStore';
import { serverEnv } from '@/lib/server/env';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export async function GET(req: Request) {
  const lim = rateLimit(`disp:${clientKey(req)}`, 60, 60_000);
  if (!lim.ok) return fail(429, 'Too many requests.', { 'Retry-After': String(lim.retryAfterSec) });
  const env = await serverEnv();
  const sp = new URL(req.url).searchParams;

  const id = sp.get('id');
  if (id) {
    if (!/^[A-Za-z0-9_.\-]{3,200}$/.test(id)) return fail(400, 'Bad id.');
    if (!env.DB) return fail(503, 'Storage is not configured on this deployment.');
    const body = await getFieldBody(env.DB, id);
    return body ? new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }) : fail(404, 'No such grid.');
  }

  const lat = Number(sp.get('lat')), lon = Number(sp.get('lon')), time = Number(sp.get('time'));
  if (![lat, lon, time].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail(400, 'lat, lon and time (epoch ms) are required.');
  if (!env.DB) return json({ configured: false, fields: [] }, 200, { 'Cache-Control': 'public, s-maxage=300' });
  try {
    return json({ configured: true, fields: await findFields(env.DB, lon, lat, time) }, 200, { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=120' });
  } catch (e) {
    console.error('[api/displacement]', e);
    return json({ configured: true, fields: [], error: 'Lookup failed.' });
  }
}
