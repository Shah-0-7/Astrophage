import { describe, it, expect } from 'vitest';
import { testDb } from './_d1';
import { upsertUser, getUser, setEmailAlerts, getRules, replaceRules, listSubscribers, unsentEventIds, markSent, pruneSent, deleteUser } from '@/lib/server/store';
import { newRule, sanitizeRules, MAX_RULES } from '@/lib/watchlist';

const profile = (sub = 'g1', email = 'a@example.com') => ({ sub, email, name: 'A', picture: '' });

describe('users', () => {
  it('creates once per Google account and refreshes details on later sign-ins', async () => {
    const db = testDb();
    const a = await upsertUser(db, profile());
    const b = await upsertUser(db, { ...profile(), email: 'new@example.com', name: 'Renamed' });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe('new@example.com');
    expect((await upsertUser(db, profile('g2', 'b@example.com'))).id).not.toBe(a.id);
    expect(a.emailAlerts).toBe(true);
  });
  it('toggles email alerts', async () => {
    const db = testDb(); const u = await upsertUser(db, profile());
    await setEmailAlerts(db, u.id, false);
    expect((await getUser(db, u.id))!.emailAlerts).toBe(false);
  });
});

describe('rules', () => {
  it('replaces the whole set and keeps order', async () => {
    const db = testDb(); const u = await upsertUser(db, profile());
    await replaceRules(db, u.id, [newRule({ name: 'one', minMagnitude: 6 }), newRule({ name: 'two', types: ['storm'], minCategory: 4 })]);
    expect((await getRules(db, u.id)).map(r => r.name)).toEqual(['one', 'two']);
    await replaceRules(db, u.id, [newRule({ name: 'only' })]);
    expect((await getRules(db, u.id)).map(r => r.name)).toEqual(['only']);
    await replaceRules(db, u.id, []);
    expect(await getRules(db, u.id)).toEqual([]);
  });
  it('keeps users apart', async () => {
    const db = testDb(); const a = await upsertUser(db, profile('g1')), b = await upsertUser(db, profile('g2', 'b@example.com'));
    await replaceRules(db, a.id, [newRule({ name: 'mine' })]);
    expect(await getRules(db, b.id)).toEqual([]);
  });
  it('sanitises untrusted rules', () => {
    const rules = sanitizeRules([
      { id: 'ok-1', name: 'x'.repeat(200), types: ['storm', 'nope', 'storm'], region: 'atlantis', minMagnitude: 99, minCategory: -3, at: { lat: 200, lon: 0 } },
      'string', null, { id: 'ok-1', types: 'bad' }, { at: { lat: 35, lon: 139, name: 'Tokyo', radiusKm: 99999 } },
    ]);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ id: 'ok-1', types: ['storm'], region: '', minMagnitude: 10, minCategory: 0, at: null });
    expect(rules[0].name).toHaveLength(60);
    expect(rules[1].id).not.toBe('ok-1');            // duplicate id replaced
    expect(rules[2].at).toMatchObject({ radiusKm: 5000, name: 'Tokyo' });
    expect(sanitizeRules(Array.from({ length: 50 }, () => ({})))).toHaveLength(MAX_RULES);
    expect(sanitizeRules('nope')).toEqual([]);
  });
});

describe('subscribers and sent log', () => {
  it('lists only users with alerts on and at least one rule', async () => {
    const db = testDb();
    const a = await upsertUser(db, profile('g1')), b = await upsertUser(db, profile('g2', 'b@example.com')), c = await upsertUser(db, profile('g3', 'c@example.com'));
    await replaceRules(db, a.id, [newRule({ name: 'a' })]);
    await replaceRules(db, b.id, [newRule({ name: 'b' })]); await setEmailAlerts(db, b.id, false);
    void c;
    const subs = await listSubscribers(db);
    expect(subs.map(s => s.user.email)).toEqual(['a@example.com']);
    expect(subs[0].rules[0].name).toBe('a');
  });
  it('never sends the same event twice and prunes old records', async () => {
    const db = testDb(); const u = await upsertUser(db, profile());
    expect([...await unsentEventIds(db, u.id, ['e1', 'e2'])].sort()).toEqual(['e1', 'e2']);
    await markSent(db, u.id, ['e1'], 1000);
    await markSent(db, u.id, ['e1', 'e2'], 2000);       // duplicate insert is ignored
    expect([...await unsentEventIds(db, u.id, ['e1', 'e2', 'e3'])]).toEqual(['e3']);
    await pruneSent(db, 1500);
    expect([...await unsentEventIds(db, u.id, ['e1', 'e2'])]).toEqual(['e1']);   // e1 pruned? no: re-sent at 2000 is ignored, so its 1000 row was pruned
  });
  it('handles many ids at once', async () => {
    const db = testDb(); const u = await upsertUser(db, profile());
    const ids = Array.from({ length: 130 }, (_, i) => `e${i}`);
    await markSent(db, u.id, ids.slice(0, 100));
    expect((await unsentEventIds(db, u.id, ids)).size).toBe(30);
  });
});

describe('deleteUser', () => {
  it('removes the account, rules and send log', async () => {
    const db = testDb(); const u = await upsertUser(db, profile());
    await replaceRules(db, u.id, [newRule({})]); await markSent(db, u.id, ['e1']);
    await deleteUser(db, u.id);
    expect(await getUser(db, u.id)).toBeNull();
    expect(await getRules(db, u.id)).toEqual([]);
    expect((await unsentEventIds(db, u.id, ['e1'])).size).toBe(1);
  });
});
