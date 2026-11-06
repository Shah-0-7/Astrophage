/**
 * /api/nisar/coverage?lat=&lon=&time= – what NASA's catalogue says NISAR has observed at an event's location, and which
 * interferogram products (GUNW, GOFF, RUNW, RIFG, ROFF) could contain its ground motion.
 * Metadata only: this never downloads or processes NISAR files.
 */
import { clientKey, rateLimit } from '@/lib/rateLimit';
import { INTERFEROGRAM_PRODUCTS, NISAR_ARCHIVE_START, PRODUCTS } from '@/lib/nisar/catalog';
import { matchInterferograms, scenesCovering, summarizeCoverage } from '@/lib/nisar/match';
import { OPERA_DISP_LINKS, operaDispFit } from '@/lib/nisar/opera';
import { queryScenes } from '@/lib/nisar/service';
import type { NisarScene } from '@/lib/nisar/types';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' };
const reply = (body: unknown, status = 200, h: Record<string, string> = H) => new Response(JSON.stringify(body), { status, headers: h });
const brief = (s: NisarScene) => ({ id: s.id, product: s.product, productName: PRODUCTS[s.product].name, maturity: s.maturity, start: s.start, end: s.end, track: s.track ?? null, frame: s.frame ?? null, direction: s.direction ?? null, pairReference: s.pair?.reference ?? null, pairSecondary: s.pair?.secondary ?? null, pairSource: s.pair?.source ?? null, sizeMb: s.sizeMb ?? null, metadataUrl: s.metadataUrl, dataUrl: s.dataUrl ?? null });

export async function GET(req: Request) {
  const limit = rateLimit(`nisarcov:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) return reply({ error: 'Too many requests' }, 429, { 'Content-Type': 'application/json', 'Retry-After': String(limit.retryAfterSec) });

  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get('lat')), lon = Number(sp.get('lon')), time = Number(sp.get('time'));
  if (![lat, lon, time].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return reply({ error: 'lat, lon and time (epoch ms) are required' }, 400, { 'Content-Type': 'application/json' });

  const opera = { fit: operaDispFit(lon, lat, time), ...OPERA_DISP_LINKS };
  const now = Date.now();
  if (time > now) return reply({ status: 'future', opera });
  if (time < NISAR_ARCHIVE_START - 86_400_000 * 30) return reply({ status: 'pre-mission', archiveStart: NISAR_ARCHIVE_START, opera });

  // Two small point queries: everything that covers the point, and interferograms that overlap the time after the event.
  const [all, insar] = await Promise.all([
    queryScenes({ point: [lon, lat], from: NISAR_ARCHIVE_START, limit: 500 }),
    queryScenes({ point: [lon, lat], products: INTERFEROGRAM_PRODUCTS, from: Math.max(NISAR_ARCHIVE_START, time - 86_400_000), limit: 200 }),
  ]);
  if (!all.ok && !insar.ok) return reply({ status: 'unavailable', error: all.error, opera }, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

  const covering = scenesCovering(all.scenes, lon, lat);
  const matches = matchInterferograms(insar.scenes, lon, lat, time);
  return reply({
    status: 'ok',
    partial: !all.ok || !insar.ok,
    coverage: summarizeCoverage(covering, time),
    latest: covering.slice(0, 5).map(brief),
    interferograms: matches.slice(0, 12).map(m => ({ fit: m.fit, spanDays: Math.round(m.spanDays * 10) / 10, ...brief(m.scene) })),
    interferogramTotal: matches.length,
    truncated: all.hits > all.scenes.length,
    opera,
  });
}
