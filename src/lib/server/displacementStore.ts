import type { Db } from './db';
import type { FieldMeta, FieldWire } from '@/lib/displacement/field';
import { metaOf } from '@/lib/displacement/field';

interface Row { id: string; maturity: string; west: number; south: number; east: number; north: number; ref_ms: number; sec_ms: number; body: string }

/** Insert or replace the grid for a granule. */
export async function saveField(db: Db, w: FieldWire, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO displacement_fields (id, maturity, west, south, east, north, ref_ms, sec_ms, created_at, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET maturity = excluded.maturity, west = excluded.west, south = excluded.south, east = excluded.east, north = excluded.north,
      ref_ms = excluded.ref_ms, sec_ms = excluded.sec_ms, created_at = excluded.created_at, body = excluded.body`)
    .bind(w.id, w.maturity, w.bbox[0], w.bbox[1], w.bbox[2], w.bbox[3], w.reference, w.secondary, now, JSON.stringify(w)).run();
}

/** Grids covering the point whose date pair spans the time, shortest pair first. Metadata only. */
export async function findFields(db: Db, lon: number, lat: number, time: number): Promise<FieldMeta[]> {
  const { results } = await db.prepare(
    `SELECT body FROM displacement_fields WHERE west <= ? AND east >= ? AND south <= ? AND north >= ? AND ref_ms <= ? AND sec_ms >= ?
     ORDER BY (sec_ms - ref_ms) ASC LIMIT 20`).bind(lon, lon, lat, lat, time, time).all<Pick<Row, 'body'>>();
  return results.map(r => metaOf(JSON.parse(r.body) as FieldWire));
}

/** The most recently stored grids (metadata only), for checking what the site holds. */
export async function listFields(db: Db, limit = 50): Promise<(FieldMeta & { storedAt: number })[]> {
  const { results } = await db.prepare('SELECT body, created_at FROM displacement_fields ORDER BY created_at DESC LIMIT ?').bind(limit).all<Pick<Row, 'body'> & { created_at: number }>();
  return results.map(r => ({ ...metaOf(JSON.parse(r.body) as FieldWire), storedAt: r.created_at }));
}

export async function getFieldBody(db: Db, id: string): Promise<string | null> {
  const r = await db.prepare('SELECT body FROM displacement_fields WHERE id = ?').bind(id).first<Pick<Row, 'body'>>();
  return r?.body ?? null;
}

export async function deleteField(db: Db, id: string): Promise<void> {
  await db.prepare('DELETE FROM displacement_fields WHERE id = ?').bind(id).run();
}
