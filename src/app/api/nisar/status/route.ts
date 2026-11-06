/** /api/nisar/status – can this deployment reach NASA CMR, and is NISAR data being returned? Open it in a browser to check. */
import { queryScenes } from '@/lib/nisar/service';

export async function GET() {
  const t0 = Date.now();
  const r = await queryScenes({ products: ['GCOV', 'GUNW'], limit: 1 });
  return new Response(JSON.stringify({ cmrReachable: r.ok, nisarGranulesFound: r.hits, newest: r.scenes[0]?.id ?? null, newestAcquired: r.scenes[0] ? new Date(r.scenes[0].start).toISOString() : null, error: r.error ?? null, ms: Date.now() - t0 }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
