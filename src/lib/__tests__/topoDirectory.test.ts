import { describe, expect, it } from 'vitest';
import { buildTopoEntries } from '@/lib/displacement/directory';
import type { FieldMeta } from '@/lib/displacement/field';
import type { GlobalEvent } from '@/lib/globalEvents';

const D = 86_400_000;
const T = Date.UTC(2026, 8, 30);
const ev = (id: string, type: GlobalEvent['type'], lat: number, lon: number, time: number, magnitude: number | null = 6): GlobalEvent => ({
  id, type, cause: 'natural', title: id, lat, lon, time, magnitude, depth: null, displacement_cm: null, source: 'USGS', source_url: '', sources: ['USGS'],
});
const grid = (id: string, bbox: FieldMeta['bbox'], ref: number, sec: number): FieldMeta => ({ id, maturity: 'PROVISIONAL', track: 1, frame: 2, direction: 'D', reference: ref, secondary: sec, bbox, nx: 10, ny: 10 });

describe('topo directory', () => {
  const metas = [grid('wide', [-82, 6, -78, 10], T - 6 * D, T + 6 * D), grid('short', [-81, 7, -79, 9], T - D, T + D), grid('lonely', [100, 30, 102, 32], T, T + 12 * D)];
  const events = [
    ev('quake', 'tectonic', 8, -80, T),
    ev('far', 'tectonic', 40, 10, T),
    ev('storm', 'storm', 8, -80, T, null),
    ev('before', 'tectonic', 8, -80, T - 20 * D),
  ];

  it('lists only events that a grid contains and spans, shortest pair first', () => {
    const rows = buildTopoEntries(events, metas.slice(0, 2));
    expect(rows.map(r => r.key)).toEqual(['quake']);
    expect(rows[0].grids.map(g => g.id)).toEqual(['short', 'wide']);
  });

  it('gives a grid that explains no event a row of its own, at its centre', () => {
    const rows = buildTopoEntries(events, metas);
    const lonely = rows.find(r => r.orphan);
    expect(lonely?.key).toBe('grid:lonely');
    expect(lonely?.event).toMatchObject({ lat: 31, lon: 101 });
  });

  it('puts the newest event first and ignores storms', () => {
    const rows = buildTopoEntries(events, metas);
    expect(rows.map(r => r.key)).toEqual(['grid:lonely', 'quake']);
    expect(rows.some(r => r.key === 'storm')).toBe(false);
  });
});
