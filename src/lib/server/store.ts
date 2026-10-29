import type { Db } from './db';
import { sanitizeRules, type WatchRule } from '@/lib/watchlist';
import { randomToken } from './crypto';

export interface User { id: string; email: string; name: string; picture: string; emailAlerts: boolean }

interface UserRow { id: string; email: string; name: string; picture: string; email_alerts: number }
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, picture: r.picture, emailAlerts: r.email_alerts === 1 });

/** Create the account on first sign-in, refresh name/picture/email on later ones. */
export async function upsertUser(db: Db, p: { sub: string; email: string; name: string; picture: string }, now = Date.now()): Promise<User> {
  const existing = await db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(p.sub).first<{ id: string }>();
  if (existing) {
    await db.prepare('UPDATE users SET email = ?, name = ?, picture = ?, last_login = ? WHERE id = ?').bind(p.email, p.name, p.picture, now, existing.id).run();
    return (await getUser(db, existing.id))!;
  }
  const id = `u_${randomToken(12)}`;
  await db.prepare('INSERT INTO users (id, google_sub, email, name, picture, email_alerts, created_at, last_login) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, p.sub, p.email, p.name, p.picture, now, now).run();
  return (await getUser(db, id))!;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const r = await db.prepare('SELECT id, email, name, picture, email_alerts FROM users WHERE id = ?').bind(id).first<UserRow>();
  return r ? toUser(r) : null;
}

export async function setEmailAlerts(db: Db, userId: string, on: boolean): Promise<void> {
  await db.prepare('UPDATE users SET email_alerts = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
}

export async function getRules(db: Db, userId: string): Promise<WatchRule[]> {
  const { results } = await db.prepare('SELECT body FROM watch_rules WHERE user_id = ? ORDER BY position ASC').bind(userId).all<{ body: string }>();
  const parsed: unknown[] = [];
  for (const r of results) { try { parsed.push(JSON.parse(r.body)); } catch { /* skip a corrupt row */ } }
  return sanitizeRules(parsed);
}

/** Replace the user's whole rule set (the client sends the full list). */
export async function replaceRules(db: Db, userId: string, rules: WatchRule[]): Promise<WatchRule[]> {
  const clean = sanitizeRules(rules);
  await db.batch([
    db.prepare('DELETE FROM watch_rules WHERE user_id = ?').bind(userId),
    ...clean.map((r, i) => db.prepare('INSERT INTO watch_rules (id, user_id, body, position) VALUES (?, ?, ?, ?)').bind(r.id, userId, JSON.stringify(r), i)),
  ]);
  return clean;
}

export interface Subscriber { user: User; rules: WatchRule[] }

/** Everyone who has email alerts on and at least one rule. */
export async function listSubscribers(db: Db): Promise<Subscriber[]> {
  const { results: users } = await db.prepare(
    'SELECT id, email, name, picture, email_alerts FROM users WHERE email_alerts = 1 AND id IN (SELECT DISTINCT user_id FROM watch_rules)',
  ).all<UserRow>();
  if (!users.length) return [];
  const { results: rows } = await db.prepare('SELECT user_id, body FROM watch_rules ORDER BY user_id, position ASC').all<{ user_id: string; body: string }>();
  const byUser = new Map<string, unknown[]>();
  for (const r of rows) {
    try { (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(JSON.parse(r.body)); } catch { /* skip */ }
  }
  return users.map(u => ({ user: toUser(u), rules: sanitizeRules(byUser.get(u.id) ?? []) })).filter(s => s.rules.length > 0);
}

/** Of these event ids, which has this user not been emailed about yet? */
export async function unsentEventIds(db: Db, userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const sent = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { results } = await db.prepare(`SELECT event_id FROM alerts_sent WHERE user_id = ? AND event_id IN (${chunk.map(() => '?').join(',')})`).bind(userId, ...chunk).all<{ event_id: string }>();
    results.forEach(r => sent.add(r.event_id));
  }
  return new Set(ids.filter(id => !sent.has(id)));
}

export async function markSent(db: Db, userId: string, ids: string[], now = Date.now()): Promise<void> {
  if (!ids.length) return;
  await db.batch(ids.map(id => db.prepare('INSERT OR IGNORE INTO alerts_sent (user_id, event_id, sent_at) VALUES (?, ?, ?)').bind(userId, id, now)));
}

/** Forget old send records (events that old can no longer match the alert window). */
export async function pruneSent(db: Db, olderThanMs: number): Promise<void> {
  await db.prepare('DELETE FROM alerts_sent WHERE sent_at < ?').bind(olderThanMs).run();
}

/** Delete the account and everything stored for it. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM alerts_sent WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM watch_rules WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}
