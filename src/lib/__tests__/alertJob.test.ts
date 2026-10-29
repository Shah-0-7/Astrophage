import { describe, it, expect, vi } from 'vitest';
import { testDb } from './_d1';
import { upsertUser, replaceRules, setEmailAlerts } from '@/lib/server/store';
import { runAlertJob, alertKey } from '@/lib/server/alertJob';
import { buildAlertEmail, esc } from '@/lib/server/alertEmail';
import { newRule } from '@/lib/watchlist';
import type { GlobalEvent } from '@/lib/globalEvents';

const NOW = Date.UTC(2026, 9, 28, 12);
const H = 3_600_000;
const ev = (o: Partial<GlobalEvent>): GlobalEvent => ({
  id: 'usgs_1', type: 'tectonic', cause: 'natural', title: 'M 6.8 - Tokyo', lat: 35.7, lon: 139.7, time: NOW - H,
  magnitude: 6.8, depth: 10, displacement_cm: null, source: 'USGS', source_url: 'https://earthquake.usgs.gov/x', sources: ['USGS'], ...o,
});

async function setup() {
  const db = testDb();
  const u = await upsertUser(db, { sub: 'g1', email: 'me@example.com', name: 'Me', picture: '' }, NOW - 10 * H);
  await replaceRules(db, u.id, [{ ...newRule({ name: 'Big quakes', minMagnitude: 6.5 }), createdAt: NOW - 5 * H }]);
  const send = vi.fn(async () => ({ ok: true }));
  const run = (events: GlobalEvent[], failed: string[] = [], now = NOW) =>
    runAlertJob({ db, fetchEvents: async () => ({ events, failed }), send, origin: 'https://app.test', secret: 's'.repeat(40), now });
  return { db, u, send, run };
}

describe('runAlertJob', () => {
  it('emails a new match once, with one-click unsubscribe headers', async () => {
    const { send, run } = await setup();
    const first = await run([ev({}), ev({ id: 'usgs_small', magnitude: 4 })]);
    expect(first).toMatchObject({ subscribers: 1, emails: 1, alerts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const [to, mail, headers] = send.mock.calls[0] as unknown as [string, { subject: string; text: string }, Record<string, string>];
    expect(to).toBe('me@example.com');
    expect(mail.subject).toContain('M 6.8');
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.test\/api\/alerts\/unsubscribe\?u=u_/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const second = await run([ev({})]);                      // same event next run
    expect(second.emails).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('batches several matches into one email', async () => {
    const { send, run } = await setup();
    const r = await run([ev({}), ev({ id: 'usgs_2', title: 'M 7.1 - Chile', magnitude: 7.1 })]);
    expect(r).toMatchObject({ emails: 1, alerts: 2 });
    expect((send.mock.calls[0] as unknown as [string, { subject: string }])[1].subject).toContain('2 new events');
  });
  it('does not email about events from before the rule existed', async () => {
    const { send, run } = await setup();
    const r = await run([ev({ time: NOW - 30 * H })]);
    expect(r.emails).toBe(0); expect(send).not.toHaveBeenCalled();
  });
  it('skips users who turned email off', async () => {
    const { db, u, send, run } = await setup();
    await setEmailAlerts(db, u.id, false);
    expect((await run([ev({})])).subscribers).toBe(0); expect(send).not.toHaveBeenCalled();
  });
  it('retries next run when sending fails, and does not mark the event as sent', async () => {
    const { send, run } = await setup();
    send.mockResolvedValueOnce({ ok: false, error: 'Resend 500' } as never);
    const r1 = await run([ev({})]);
    expect(r1.emails).toBe(0); expect(r1.failures[0]).toContain('Resend 500');
    expect((await run([ev({})])).emails).toBe(1);
  });
  it('reports feed failures and sends nothing when every feed is down', async () => {
    const { send, run } = await setup();
    const r = await run([], ['USGS', 'GDACS']);
    expect(r.feedFailures).toEqual(['USGS', 'GDACS']); expect(send).not.toHaveBeenCalled();
  });
  it('alerts once per storm even if the feeds swap which record wins', async () => {
    const { db, u, send, run } = await setup();
    await replaceRules(db, u.id, [{ ...newRule({ types: ['storm'], minCategory: 4 }), createdAt: NOW - 5 * H }]);
    const storm = (id: string, title: string) => ev({ id, title, type: 'storm', magnitude: null, wind_kts: 120, lat: 20, lon: -60 });
    expect((await run([storm('eonet_1', 'Hurricane Rafael')])).emails).toBe(1);
    expect((await run([storm('gdacs_TC_9', 'Tropical Cyclone RAFAEL-24')])).emails).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(alertKey(storm('a', 'Hurricane Rafael'))).toBe(alertKey(storm('b', 'Tropical Cyclone RAFAEL-24')));
  });
});

describe('buildAlertEmail', () => {
  it('escapes untrusted feed text and refuses non-http source links', () => {
    const e = ev({ title: '<img src=x onerror=alert(1)> & "quote"', source_url: 'javascript:alert(1)' });
    const m = buildAlertEmail({ alerts: [{ event: e, rule: newRule({ name: '<b>rule</b>' }) }], origin: 'https://app.test', unsubscribeUrl: 'https://app.test/u' });
    expect(m.html).not.toContain('<img'); expect(m.html).not.toContain('<b>rule');
    expect(m.html).toContain('&lt;img'); expect(m.html).not.toContain('javascript:');
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
  it('caps the list and says how many more', () => {
    const alerts = Array.from({ length: 20 }, (_, i) => ({ event: ev({ id: `e${i}` }), rule: newRule({}) }));
    const m = buildAlertEmail({ alerts, origin: 'https://app.test', unsubscribeUrl: 'https://app.test/u' });
    expect(m.text).toContain('…and 8 more');
    expect(m.subject).toContain('20 new events');
  });
  it('links to the ledger with the event selected', () => {
    const m = buildAlertEmail({ alerts: [{ event: ev({ id: 'usgs_a b' }), rule: newRule({}) }], origin: 'https://app.test', unsubscribeUrl: 'https://app.test/u' });
    expect(m.text).toContain('https://app.test/events?event=usgs_a%20b');
  });
});
