import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from './_d1';
import { __setServerEnvForTests } from '@/lib/server/env';
import { _resetRateLimit } from '@/lib/rateLimit';
import { FRINGE_CM, NODATA, decodeField, encodeField, fieldStats, valueAt, validateWire, type DisplacementField } from '@/lib/displacement/field';
import { findFields } from '@/lib/server/displacementStore';
import * as list from '@/app/api/displacement/route';
import * as ingest from '@/app/api/displacement/ingest/route';

const REF = Date.UTC(2026, 7, 1), SEC = Date.UTC(2026, 7, 13), EVENT = Date.UTC(2026, 7, 5);

function field(over: Partial<DisplacementField> = {}): DisplacementField {
  const nx = 4, ny = 3;
  const cm = new Float32Array(nx * ny).map((_, i) => (i === 5 ? NaN : i * 2.5 - 10));
  return { id: 'NISAR_L2_PR_GUNW_test', maturity: 'PROVISIONAL', track: 5, frame: 18, direction: 'A', reference: REF, secondary: SEC, bbox: [86, 27, 87, 28], nx, ny, cm, ...over };
}

describe('wire format', () => {
  it('round-trips values to 0.1 cm and keeps no-data', () => {
    const f = field();
    const back = decodeField(encodeField(f));
    expect(back.nx).toBe(4); expect(back.ny).toBe(3);
    for (let i = 0; i < f.cm.length; i++) {
      if (Number.isNaN(f.cm[i])) expect(Number.isNaN(back.cm[i])).toBe(true);
      else expect(back.cm[i]).toBeCloseTo(f.cm[i], 1);
    }
  });
  it('treats non-finite and absurd values as no-data', () => {
    const f = field({ cm: new Float32Array([Infinity, 1e6, -1e6, 5, 0, 0, 0, 0, 0, 0, 0, 0]) });
    const back = decodeField(encodeField(f));
    expect([0, 1, 2].every(i => Number.isNaN(back.cm[i]))).toBe(true);
    expect(back.cm[3]).toBeCloseTo(5, 1);
  });
  it('carries coherence and notes', () => {
    const w = encodeField(field({ coh: new Uint8Array(12).fill(200), notes: 'ref = outer-ring median' }));
    const back = decodeField(w);
    expect(back.coh?.[0]).toBe(200); expect(back.notes).toBe('ref = outer-ring median');
  });
  it('looks up values by lon/lat, north row first', () => {
    const f = field();
    expect(valueAt(f, 86.1, 27.9)).toBeCloseTo(f.cm[0], 5);     // north-west cell
    expect(valueAt(f, 86.9, 27.1)).toBeCloseTo(f.cm[11], 5);    // south-east cell
    expect(valueAt(f, 85, 27.5)).toBeNull();                     // outside
    expect(valueAt(f, 86.4, 27.5)).toBeNull();                   // cell 5 is no-data
  });
  it('summarises the field', () => {
    const s = fieldStats(field())!;
    expect(s.count).toBe(11); expect(s.coverage).toBeCloseTo(11 / 12);
    expect(s.min).toBeCloseTo(-10); expect(s.max).toBeCloseTo(17.5); expect(s.maxAbs).toBeCloseTo(17.5);
    expect(fieldStats(field({ cm: new Float32Array(12).fill(NaN) }))).toBeNull();
  });
  it('one L-band fringe is about 11.9 cm of line-of-sight motion', () => { expect(FRINGE_CM).toBeCloseTo(11.92, 2); });
});

describe('validateWire', () => {
  const good = () => JSON.parse(JSON.stringify(encodeField(field())));
  it('accepts a well-formed grid', () => { expect(validateWire(good()).ok).toBe(true); });
  const cases: [string, (w: Record<string, unknown>) => void][] = [
    ['wrong version', w => { w.v = 2; }],
    ['bad id', w => { w.id = '../etc/passwd'; }],
    ['bad maturity', w => { w.maturity = 'provisional'; }],
    ['oversized grid', w => { w.nx = 300; }],
    ['secondary before reference', w => { w.secondary = w.reference; }],
    ['bbox reversed', w => { w.bbox = [87, 27, 86, 28]; }],
    ['bbox too big', w => { w.bbox = [0, 0, 20, 5]; }],
    ['wrong scale', w => { w.scale = 1; }],
    ['wrong data length', w => { w.los = 'AAAA'; }],
    ['not base64', w => { w.los = '!'.repeat((w.los as string).length); }],
    ['bad direction', w => { w.direction = 'X'; }],
    ['huge notes', w => { w.notes = 'x'.repeat(5000); }],
  ];
  for (const [name, mutate] of cases) it(`rejects ${name}`, () => { const w = good(); mutate(w); expect(validateWire(w).ok).toBe(false); });
  it('rejects non-objects', () => { expect(validateWire(null).ok).toBe(false); expect(validateWire('x').ok).toBe(false); });
});

describe('API', () => {
  const ORIGIN = 'https://app.test';
  let db: ReturnType<typeof testDb>;
  const post = (body: unknown, token: string | null = 'ingest-secret') => ingest.POST(new Request(`${ORIGIN}/api/displacement/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  beforeEach(() => { db = testDb(); __setServerEnvForTests({ DB: db, INGEST_SECRET: 'ingest-secret' }); _resetRateLimit(); });
  afterEach(() => __setServerEnvForTests(null));

  it('refuses uploads without the right token', async () => {
    const w = encodeField(field());
    expect((await post(w, null)).status).toBe(401);
    expect((await post(w, 'wrong')).status).toBe(401);
    expect((await findFields(db, 86.5, 27.5, EVENT))).toHaveLength(0);
  });
  it('refuses uploads when ingest is not configured', async () => {
    __setServerEnvForTests({ DB: db });
    expect((await post(encodeField(field()))).status).toBe(503);
  });
  it('rejects invalid grids with a reason', async () => {
    const r = await post({ ...encodeField(field()), nx: 999 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/nx and ny/);
  });
  it('stores a grid, finds it by point and time, and serves it back', async () => {
    expect((await post(encodeField(field()))).status).toBe(200);
    const meta = await (await list.GET(new Request(`${ORIGIN}/api/displacement?lat=27.5&lon=86.5&time=${EVENT}`))).json();
    expect(meta.configured).toBe(true);
    expect(meta.fields).toHaveLength(1);
    expect(meta.fields[0]).toMatchObject({ id: 'NISAR_L2_PR_GUNW_test', track: 5, frame: 18, nx: 4, ny: 3 });
    expect(meta.fields[0].los).toBeUndefined(); // metadata only
    const body = await (await list.GET(new Request(`${ORIGIN}/api/displacement?id=NISAR_L2_PR_GUNW_test`))).json();
    expect(decodeField(body).cm[0]).toBeCloseTo(-10, 1);
  });
  it('does not return grids whose pair does not span the event or that miss the point', async () => {
    await post(encodeField(field()));
    const q = (lat: number, lon: number, t: number) => list.GET(new Request(`${ORIGIN}/api/displacement?lat=${lat}&lon=${lon}&time=${t}`)).then(r => r.json());
    expect((await q(27.5, 86.5, Date.UTC(2026, 6, 20))).fields).toHaveLength(0); // before the pair
    expect((await q(27.5, 86.5, Date.UTC(2026, 7, 20))).fields).toHaveLength(0); // after
    expect((await q(10, 10, EVENT)).fields).toHaveLength(0);                     // elsewhere
  });
  it('orders by shortest pair and upserts by id', async () => {
    await post(encodeField(field({ id: 'long-pair', secondary: Date.UTC(2026, 8, 1) })));
    await post(encodeField(field({ id: 'short-pair' })));
    await post(encodeField(field({ id: 'short-pair', maturity: 'BETA' })));
    const m = await findFields(db, 86.5, 27.5, EVENT);
    expect(m.map(x => x.id)).toEqual(['short-pair', 'long-pair']);
    expect(m[0].maturity).toBe('BETA');
  });
  it('lists what is stored, newest first, with no grid values', async () => {
    await post(encodeField(field({ id: 'first' })));
    await post(encodeField(field({ id: 'second' })));
    const r = await (await list.GET(new Request(`${ORIGIN}/api/displacement?all=1`))).json();
    expect(r.configured).toBe(true);
    expect(r.fields.map((f: { id: string }) => f.id).sort()).toEqual(['first', 'second']);
    expect(r.fields[0].los).toBeUndefined();
    expect(typeof r.fields[0].storedAt).toBe('number');
  });
  it('reports "not configured" without a database and 404 for unknown ids', async () => {
    expect((await list.GET(new Request(`${ORIGIN}/api/displacement?id=nope.nope`))).status).toBe(404);
    __setServerEnvForTests({});
    const r = await (await list.GET(new Request(`${ORIGIN}/api/displacement?lat=1&lon=1&time=${EVENT}`))).json();
    expect(r).toEqual({ configured: false, fields: [] });
  });
  it('validates query parameters', async () => {
    expect((await list.GET(new Request(`${ORIGIN}/api/displacement?lat=x&lon=1&time=1`))).status).toBe(400);
    expect((await list.GET(new Request(`${ORIGIN}/api/displacement?id=../x`))).status).toBe(400);
  });
  it('deletes with the token only', async () => {
    await post(encodeField(field()));
    const del = (t: string | null) => ingest.DELETE(new Request(`${ORIGIN}/api/displacement/ingest?id=NISAR_L2_PR_GUNW_test`, { method: 'DELETE', headers: t ? { authorization: `Bearer ${t}` } : {} }));
    expect((await del(null)).status).toBe(401);
    expect((await del('ingest-secret')).status).toBe(200);
    expect(await findFields(db, 86.5, 27.5, EVENT)).toHaveLength(0);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('processor output (tools/nisar-grid) is accepted by the app', () => {
  // Written by tools/nisar-grid/tests from a synthetic GUNW with a 30 cm toward-satellite bump at 86.5E, 28.0N.
  const wire = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/__tests__/fixtures/gunw-grid.json'), 'utf8'));
  it('passes validation', () => {
    const v = validateWire(wire);
    expect(v.ok).toBe(true);
  });
  it('decodes to the values the processor intended', () => {
    const f = decodeField(wire);
    expect(valueAt(f, 86.5, 28.0)).toBeCloseTo(30, 0);
    const s = fieldStats(f)!;
    expect(s.max).toBeGreaterThan(28); expect(s.max).toBeLessThan(32);
    expect(Math.abs(valueAt(f, f.bbox[0] + 0.02, f.bbox[1] + 0.02) ?? 0)).toBeLessThan(2);
    expect(f.track).toBe(5); expect(f.direction).toBe('A');
    expect(f.secondary).toBeGreaterThan(f.reference);
  });
});

import { fmtRangeCm, matchFields } from '@/lib/displacement/match';

describe('matching grids to events in the browser', () => {
  const m = (id: string, bbox: [number, number, number, number], reference: number, secondary: number) => ({ id, bbox, reference, secondary });
  const list = [m('long', [0, 0, 10, 10], 0, 100), m('short', [0, 0, 10, 10], 40, 60), m('elsewhere', [20, 20, 30, 30], 0, 100), m('before', [0, 0, 10, 10], 0, 30)];
  it('keeps grids that contain the point and enclose the time, shortest first, like the server', () => {
    expect(matchFields(list, { lat: 5, lon: 5, time: 50 }).map(x => x.id)).toEqual(['short', 'long']);
    expect(matchFields(list, { lat: 5, lon: 5, time: 20 }).map(x => x.id)).toEqual(['before', 'long']);
  });
  it('returns nothing when no grid fits or none exist', () => {
    expect(matchFields(list, { lat: 5, lon: 5, time: 500 })).toEqual([]);
    expect(matchFields([], { lat: 5, lon: 5, time: 1 })).toEqual([]);
  });
  it('writes a signed range', () => {
    expect(fmtRangeCm(-8.14, 12.36)).toBe('−8.1 to +12.4 CM');
    expect(fmtRangeCm(0.4, 3)).toBe('+0.4 to +3.0 CM');
  });
});
