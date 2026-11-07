/**
 * /api/terrain?z=&x=&y= – one Terrarium elevation tile (PNG), relayed from the public AWS Open Data bucket so the browser
 * never depends on that host's CORS settings. Tiles never change, so they are cached for a long time.
 */
import { clientKey, rateLimit } from '@/lib/rateLimit';

const SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

export async function GET(req: Request) {
  const lim = rateLimit(`terrain:${clientKey(req)}`, 240, 60_000);
  if (!lim.ok) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(lim.retryAfterSec) } });
  const sp = new URL(req.url).searchParams;
  const [z, x, y] = ['z', 'x', 'y'].map(k => Number(sp.get(k)));
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 12 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return new Response('Bad tile', { status: 400 });
  try {
    const res = await fetch(`${SOURCE}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(9000), next: { revalidate: 2_592_000 } } as RequestInit);
    if (!res.ok) return new Response('Upstream error', { status: 502 });
    return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=2592000, immutable' } });
  } catch {
    return new Response('Upstream unreachable', { status: 502 });
  }
}
