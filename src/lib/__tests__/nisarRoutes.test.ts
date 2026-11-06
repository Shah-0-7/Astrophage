import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as granules } from '@/app/api/nisar/granules/route';
import { GET as coverage } from '@/app/api/nisar/coverage/route';
import { GET as status } from '@/app/api/nisar/status/route';
import { _resetRateLimit } from '@/lib/rateLimit';

const pt = (lon: number, lat: number, h = 1) => [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]].map(([x, y]) => ({ Longitude: x, Latitude: y }));
const item = (id: string, short: string, b: string, e: string, lon = 86, lat = 28) => ({ meta: { 'concept-id': 'G1-ASF' }, umm: { GranuleUR: id, CollectionReference: { ShortName: short }, TemporalExtent: { RangeDateTime: { BeginningDateTime: b, EndingDateTime: e } }, SpatialExtent: { HorizontalSpatialDomain: { Geometry: { GPolygons: [{ Boundary: { Points: pt(lon, lat) } }] } } } } });
const GUNW = 'NISAR_L2_PR_GUNW_004_005_A_018_4005_DHDH_A_20260801T000000_20260801T000030_20260813T000000_20260813T000030_X';
const GCOV = 'NISAR_L2_PR_GCOV_004_004_A_018_4005_DHDH_A_20260802T111130_20260802T111153_P05023_N_P_J_001';

let urls: string[];
function mockCmr(handler: (url: string) => Response) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return handler(String(u)); }));
}
const body = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200, headers: { 'CMR-Hits': String(items.length) } });
const req = (path: string) => new Request(`https://x.test${path}`);

beforeEach(() => _resetRateLimit());
afterEach(() => vi.unstubAllGlobals());

describe('/api/nisar/granules', () => {
  it('requires a sane bbox', async () => {
    expect((await granules(req('/api/nisar/granules'))).status).toBe(400);
    const big = await granules(req('/api/nisar/granules?bbox=-180,-80,180,80'));
    expect(big.status).toBe(400);
    expect((await big.json()).tooLarge).toBe(true);
  });
  it('returns GeoJSON for scenes in view', async () => {
    mockCmr(() => body([item(GCOV, 'NISAR_L2_GCOV_PROVISIONAL_V1', '2026-08-02T11:11:30Z', '2026-08-02T11:11:53Z')]));
    const r = await granules(req('/api/nisar/granules?bbox=80,20,90,30&days=30&products=GCOV'));
    const j = await r.json();
    expect(j.features).toHaveLength(1);
    expect(j.features[0].properties).toMatchObject({ product: 'GCOV', insar: false, track: 4, frame: 18 });
    expect(j.meta).toMatchObject({ ok: true, count: 1, truncated: false });
    expect(urls[0]).toContain('bounding_box=80,20,90,30');
    expect(urls[0]).toContain('short_name[]=NISAR_L2_GCOV_PROVISIONAL_V1');
    expect(urls[0]).not.toContain('GUNW');
  });
  it('reports a CMR outage as meta.ok=false with an empty collection', async () => {
    mockCmr(() => new Response('bad', { status: 503 }));
    const j = await (await granules(req('/api/nisar/granules?bbox=80,20,90,30'))).json();
    expect(j.features).toEqual([]);
    expect(j.meta.ok).toBe(false);
  });
  it('rate limits', async () => {
    mockCmr(() => body([]));
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await granules(req('/api/nisar/granules?bbox=80,20,90,30'))).status;
    expect(last).toBe(429);
  });
});

describe('/api/nisar/coverage', () => {
  const EVENT = Date.UTC(2026, 7, 5);
  it('rejects bad input', async () => {
    expect((await coverage(req('/api/nisar/coverage?lat=abc&lon=1&time=1'))).status).toBe(400);
  });
  it('does not query for events before the archive or in the future', async () => {
    mockCmr(() => body([]));
    expect((await (await coverage(req(`/api/nisar/coverage?lat=28&lon=86&time=${Date.UTC(2015, 3, 25)}`))).json()).status).toBe('pre-mission');
    expect((await (await coverage(req(`/api/nisar/coverage?lat=28&lon=86&time=${Date.now() + 86_400_000 * 5}`))).json()).status).toBe('future');
    expect(urls).toHaveLength(0);
  });
  it('combines coverage and interferogram matches', async () => {
    mockCmr(u => (u.includes('GUNW') && !u.includes('GCOV')
      ? body([item(GUNW, 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:30Z')])
      : body([item(GCOV, 'NISAR_L2_GCOV_PROVISIONAL_V1', '2026-08-02T11:11:30Z', '2026-08-02T11:11:53Z'), item(GUNW, 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:30Z')])));
    const j = await (await coverage(req(`/api/nisar/coverage?lat=28&lon=86&time=${EVENT}`))).json();
    expect(j.status).toBe('ok');
    expect(j.coverage.total).toBe(2);
    expect(j.interferograms).toHaveLength(1);
    expect(j.interferograms[0]).toMatchObject({ fit: 'spans-event', product: 'GUNW', spanDays: 12 });
    expect(j.opera.fit).toBe('outside-region');
    expect(urls).toHaveLength(2);
    expect(urls.every(u => u.includes('point=86,28'))).toBe(true);
  });
  it('says "unavailable" (not an error page) when CMR is down', async () => {
    mockCmr(() => new Response('x', { status: 500 }));
    const r = await coverage(req(`/api/nisar/coverage?lat=28&lon=86&time=${EVENT}`));
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('unavailable');
  });
});

describe('/api/nisar/status', () => {
  it('reports reachability and the newest scene', async () => {
    mockCmr(() => body([item(GCOV, 'NISAR_L2_GCOV_PROVISIONAL_V1', '2026-08-02T11:11:30Z', '2026-08-02T11:11:53Z')]));
    const j = await (await status()).json();
    expect(j).toMatchObject({ cmrReachable: true, nisarGranulesFound: 1, newest: GCOV });
  });
});
