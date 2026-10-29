/** A D1-shaped wrapper over node:sqlite, so the store can be tested against real SQL. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db, DbStatement } from '@/lib/server/db';

export function testDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(join(process.cwd(), 'migrations/0001_accounts_and_alerts.sql'), 'utf8'));
  const stmt = (sql: string, params: unknown[] = []): DbStatement => ({
    bind: (...v) => stmt(sql, v),
    async run() { const r = sqlite.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
    async all<T>() { return { results: sqlite.prepare(sql).all(...(params as never[])) as T[] }; },
    async first<T>() { return (sqlite.prepare(sql).get(...(params as never[])) as T | undefined) ?? null; },
  });
  return {
    prepare: sql => stmt(sql),
    async batch(list) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}
