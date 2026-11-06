import { describe, it, expect } from 'vitest';
import { buildGranuleUrl, parseGranules, parseGranuleName } from '@/lib/nisar/cmr';
import { collectionName, parseCollection } from '@/lib/nisar/catalog';
import { pointInRing } from '@/lib/nisar/geometry';
import { matchInterferograms, scenesCovering, summarizeCoverage } from '@/lib/nisar/match';

const GCOV = 'NISAR_L2_PR_GCOV_004_004_A_018_4005_DHDH_A_20251029T111130_20251029T111153_P05023_N_P_J_001';

/** A CMR UMM-JSON item with a square footprint centred on (lon, lat), half-width h degrees. */
function item(id: string, short: string, begin: string, end: string, lon: number, lat: number, h = 1, extra: object = {}) {
  const pts = [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]];
  return {
    meta: { 'concept-id': `G${id.length}-ASF` },
    umm: {
      GranuleUR: id,
      CollectionReference: { ShortName: short },
      TemporalExtent: { RangeDateTime: { BeginningDateTime: begin, EndingDateTime: end } },
      SpatialExtent: { HorizontalSpatialDomain: { Geometry: { GPolygons: [{ Boundary: { Points: pts.map(([x, y]) => ({ Longitude: x, Latitude: y })) } }] } } },
      RelatedUrls: [{ URL: `https://datapool.asf.alaska.edu/${id}.h5`, Type: 'GET DATA' }, { URL: 'http://insecure.example/x', Type: 'GET DATA' }],
      DataGranule: { ArchiveAndDistributionInformation: [{ SizeInBytes: 5 * 1_048_576 }] },
      ...extra,
    },
  };
}

describe('granule names and collections', () => {
  it('reads cycle, track, direction, frame and timestamps', () => {
    const n = parseGranuleName(GCOV);
    expect(n).toMatchObject({ cycle: 4, track: 4, direction: 'A', frame: 18 });
    expect(n.stamps).toEqual([Date.UTC(2025, 9, 29, 11, 11, 30), Date.UTC(2025, 9, 29, 11, 11, 53)]);
  });
  it('tolerates names that do not follow the pattern', () => {
    expect(parseGranuleName('something_else')).toEqual({ stamps: [] });
  });
  it('round-trips collection names', () => {
    expect(collectionName('GUNW', 'PROVISIONAL')).toBe('NISAR_L2_GUNW_PROVISIONAL_V1');
    expect(collectionName('RIFG', 'BETA')).toBe('NISAR_L1_RIFG_BETA_V1');
    expect(parseCollection('NISAR_L2_GCOV_BETA_V1')).toEqual({ product: 'GCOV', maturity: 'BETA' });
    expect(parseCollection('NISAR_L2_NOPE_BETA_V1')).toBeNull();
    expect(parseCollection('SENTINEL-1')).toBeNull();
  });
});

describe('buildGranuleUrl', () => {
  it('asks CMR for the chosen collections, point and open-ended time range, newest first', () => {
    const u = buildGranuleUrl({ products: ['GUNW'], maturities: ['PROVISIONAL'], point: [86.12345, 27.98762], from: Date.UTC(2026, 6, 1) });
    expect(u).toContain('granules.umm_json?');
    expect(u).toContain('short_name[]=NISAR_L2_GUNW_PROVISIONAL_V1');
    expect(u).not.toContain('BETA');
    expect(u).toContain('point=86.1235,27.9876');
    expect(u).toContain('temporal[]=2026-07-01T00:00:00Z,');
    expect(u).toContain('sort_key[]=-start_date');
  });
  it('clamps the bounding box and page size', () => {
    const u = buildGranuleUrl({ bbox: [-200, -95, 200, 95], limit: 99999 });
    expect(u).toContain('bounding_box=-180,-90,180,90');
    expect(u).toContain('page_size=500');
  });
  it('covers every product and both maturities by default', () => {
    expect((buildGranuleUrl({}).match(/short_name\[\]/g) ?? []).length).toBe(18);
  });
});

describe('parseGranules', () => {
  it('parses a single-acquisition scene', () => {
    const [s] = parseGranules({ items: [item(GCOV, 'NISAR_L2_GCOV_PROVISIONAL_V1', '2025-10-29T11:11:30Z', '2025-10-29T11:11:53Z', 85, 28)] });
    expect(s).toMatchObject({ id: GCOV, product: 'GCOV', maturity: 'PROVISIONAL', cycle: 4, track: 4, direction: 'A', frame: 18, sizeMb: 5 });
    expect(s.pair).toBeUndefined();
    expect(s.bbox).toEqual([84, 27, 86, 29]);
    expect(s.dataUrl).toBe(`https://datapool.asf.alaska.edu/${GCOV}.h5`); // the http:// link is ignored
    expect(s.metadataUrl).toMatch(/^https:\/\/cmr\.earthdata\.nasa\.gov\/search\/concepts\/G.*\.html$/);
  });
  it('takes interferogram pair dates from the file name when four timestamps are present', () => {
    const id = 'NISAR_L2_PR_GUNW_004_005_A_018_4005_DHDH_A_20260801T000000_20260801T000030_20260813T000000_20260813T000030_X';
    const [s] = parseGranules({ items: [item(id, 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:30Z', 0, 0)] });
    expect(s.pair).toEqual({ reference: Date.UTC(2026, 7, 1), secondary: Date.UTC(2026, 7, 13), source: 'name' });
  });
  it('falls back to a long CMR time range for the pair, and ignores a short one', () => {
    const long = parseGranules({ items: [item('GUNW_a', 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:00Z', 0, 0)] })[0];
    expect(long.pair?.source).toBe('metadata');
    const short = parseGranules({ items: [item('GUNW_b', 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-01T00:01:00Z', 0, 0)] })[0];
    expect(short.pair).toBeUndefined();
  });
  it('skips malformed items without throwing', () => {
    const bad = [{}, { umm: { GranuleUR: 'x' } }, item('ok', 'NISAR_L2_GCOV_BETA_V1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1, 1), item('wrongcol', 'SOMETHING', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1, 1), null];
    expect(parseGranules({ items: bad }).map(s => s.id)).toEqual(['ok']);
    expect(parseGranules(null)).toEqual([]);
    expect(parseGranules({ items: 'nope' })).toEqual([]);
  });
  it('accepts a bounding-rectangle footprint', () => {
    const it0 = item('rect', 'NISAR_L2_GCOV_BETA_V1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 0, 0);
    (it0.umm.SpatialExtent.HorizontalSpatialDomain.Geometry as object) = { BoundingRectangles: [{ WestBoundingCoordinate: 10, EastBoundingCoordinate: 12, SouthBoundingCoordinate: 20, NorthBoundingCoordinate: 22 }] };
    expect(parseGranules({ items: [it0] })[0].bbox).toEqual([10, 20, 12, 22]);
  });
});

describe('geometry', () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  it('point in ring', () => { expect(pointInRing(5, 5, sq)).toBe(true); expect(pointInRing(11, 5, sq)).toBe(false); });
  it('works across the antimeridian', () => {
    const ring: [number, number][] = [[175, 0], [-175, 0], [-175, 10], [175, 10], [175, 0]];
    expect(pointInRing(179, 5, ring)).toBe(true);
    expect(pointInRing(-178, 5, ring)).toBe(true);
    expect(pointInRing(0, 5, ring)).toBe(false);
  });
});

describe('coverage and interferogram matching', () => {
  const EVENT = Date.UTC(2026, 7, 5); // 5 Aug 2026
  const pairId = (a: string, b: string) => `NISAR_L2_PR_GUNW_004_005_A_018_4005_DHDH_A_${a}T000000_${a}T000030_${b}T000000_${b}T000030_X`;
  const scenes = parseGranules({ items: [
    item(pairId('20260801', '20260813'), 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:30Z', 86, 28),           // spans, 12 d
    item(pairId('20260725', '20260825'), 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-07-25T00:00:00Z', '2026-08-25T00:00:30Z', 86, 28),           // spans, 31 d
    item(pairId('20260810', '20260822'), 'NISAR_L2_GOFF_PROVISIONAL_V1', '2026-08-10T00:00:00Z', '2026-08-22T00:00:30Z', 86, 28),           // after
    item(pairId('20260701', '20260713'), 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-07-01T00:00:00Z', '2026-07-13T00:00:30Z', 86, 28),           // before: dropped
    item(pairId('20260801', '20260813'), 'NISAR_L2_GUNW_PROVISIONAL_V1', '2026-08-01T00:00:00Z', '2026-08-13T00:00:30Z', 40, 10),           // elsewhere
    item(GCOV, 'NISAR_L2_GCOV_PROVISIONAL_V1', '2026-08-02T11:11:30Z', '2026-08-02T11:11:53Z', 86, 28),                                    // not InSAR
    item('NISAR_L2_PR_GCOV_004_004_A_018_4005_DHDH_A_20260820T111130_20260820T111153_P05023_N_P_J_001', 'NISAR_L2_GCOV_PROVISIONAL_V1', '2026-08-20T11:11:30Z', '2026-08-20T11:11:53Z', 86, 28),
  ] });

  it('finds only scenes whose footprint contains the point', () => {
    expect(scenesCovering(scenes, 86, 28)).toHaveLength(6);
    expect(scenesCovering(scenes, 86, 31)).toHaveLength(0);
  });
  it('summarises coverage', () => {
    const c = summarizeCoverage(scenesCovering(scenes, 86, 28), EVENT);
    expect(c.total).toBe(6);
    expect(c.byProduct).toMatchObject({ GUNW: 3, GOFF: 1, GCOV: 2 });
    expect(c.firstSeen).toBe(Date.UTC(2026, 6, 1));
    expect(c.afterEvent).toBe(2); // the Aug 10 offsets and the Aug 20 backscatter scene
  });
  it('ranks interferograms that span the event first, shortest span first, and drops pre-event pairs', () => {
    const m = matchInterferograms(scenes, 86, 28, EVENT);
    expect(m.map(x => x.fit)).toEqual(['spans-event', 'spans-event', 'after-event']);
    expect(m.map(x => Math.round(x.spanDays))).toEqual([12, 31, 12]);
    expect(m[2].scene.product).toBe('GOFF');
  });
  it('returns nothing for a point with no coverage', () => {
    expect(matchInterferograms(scenes, -100, 0, EVENT)).toEqual([]);
  });
});

import { inOperaDispRegion, operaDispFit } from '@/lib/nisar/opera';
import { queryScenes } from '@/lib/nisar/service';

describe('OPERA DISP-S1 coverage hint', () => {
  it('flags North America and the covered period only', () => {
    expect(inOperaDispRegion(-118, 34)).toBe(true);   // California
    expect(inOperaDispRegion(-150, 61)).toBe(true);   // Alaska
    expect(inOperaDispRegion(86, 28)).toBe(false);    // Himalaya
    expect(operaDispFit(-118, 34, Date.UTC(2019, 6, 6))).toBe('covered-period');
    expect(operaDispFit(-118, 34, Date.UTC(2026, 0, 1))).toBe('outside-period');
    expect(operaDispFit(86, 28, Date.UTC(2019, 6, 6))).toBe('outside-region');
  });
});

describe('queryScenes', () => {
  const ok = (body: unknown, hits = '1') => (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'CMR-Hits': hits } })) as unknown as typeof fetch;
  it('parses a good response and reports total hits', async () => {
    const r = await queryScenes({}, ok({ items: [item(GCOV, 'NISAR_L2_GCOV_BETA_V1', '2025-10-29T11:11:30Z', '2025-10-29T11:11:53Z', 85, 28)] }, '42'));
    expect(r).toMatchObject({ ok: true, hits: 42 });
    expect(r.scenes).toHaveLength(1);
  });
  it('turns HTTP errors and network failures into ok:false', async () => {
    expect((await queryScenes({}, (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).ok).toBe(false);
    const boom = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    expect(await queryScenes({}, boom)).toMatchObject({ ok: false, error: 'network down' });
  });
});
