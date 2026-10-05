/**
 * ============================================================
 * PostGIS Client & Query Helpers
 * ============================================================
 * Wraps node-postgres (pg) with graceful fallback.
 * If PostGIS is unavailable, fault-distance functions return
 * null and the stream falls back to untagged events.
 * ============================================================
 */

import { Pool } from 'pg';

const DB_URL =
  process.env.DATABASE_URL ??
  'postgresql://nisar:nisar_secret@localhost:5432/nisar_spatial';

let _pool: Pool | null = null;
let _unavailable = false;

export function getPool(): Pool | null {
  if (_unavailable) return null;
  if (_pool) return _pool;

  _pool = new Pool({
    connectionString: DB_URL,
    max:              5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });

  _pool.on('error', (err) => {
    if (!_unavailable) {
      console.warn('[postgis] unavailable, spatial tagging disabled:', err.message);
      _unavailable = true;
      _pool = null;
    }
  });

  return _pool;
}

/**
 * Tag a seismic event as INTERPLATE or INTRAPLATE by computing
 * its orthogonal distance to the nearest PB2002 fault line.
 * Returns null if PostGIS is unavailable.
 */
export async function tagSeismicEvent(
  eventId: string,
): Promise<{ subtype: 'INTERPLATE' | 'INTRAPLATE'; distanceM: number; faultName: string } | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await pool.query<{
      distance_m: number;
      fault_name: string;
      subtype: 'INTERPLATE' | 'INTRAPLATE';
    }>('SELECT * FROM tag_seismic_event($1)', [eventId]);

    const row = result.rows[0];
    if (!row) return null;

    return {
      subtype:   row.subtype,
      distanceM: row.distance_m,
      faultName: row.fault_name,
    };
  } catch (err) {
    console.error('[postgis] tagSeismicEvent error:', err);
    return null;
  }
}

/**
 * Upsert a seismic event into the PostGIS store.
 * Silently skips if the DB is unavailable.
 */
export async function upsertSeismicEvent(event: {
  id: string;
  magnitude: number;
  place: string;
  depth_km: number;
  tsunami: number;
  sig: number;
  event_time: string;
  url: string;
  lng: number;
  lat: number;
}): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO seismic_events
        (id, magnitude, place, depth_km, tsunami, sig, event_time, url, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326))
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.magnitude,
        event.place,
        event.depth_km,
        event.tsunami,
        event.sig,
        event.event_time,
        event.url,
        event.lng,
        event.lat,
      ],
    );
  } catch (err) {
    console.error('[postgis] upsertSeismicEvent error:', err);
  }
}
