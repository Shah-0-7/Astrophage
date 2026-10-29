import type { GlobalEvent } from '@/lib/globalEvents';
import { stormKey } from '@/lib/globalEvents';
import { ALERT_WINDOW_MS, findAlerts, shouldNotify, type WatchAlert } from '@/lib/watchlist';
import type { Db } from './db';
import { listSubscribers, markSent, pruneSent, unsentEventIds } from './store';
import { buildAlertEmail } from './alertEmail';
import { unsubscribeHeaders, type Sender } from './mailer';
import { unsubscribeUrl } from './unsub';

/** Identity used to remember that someone was told: the same storm keeps one key whichever feed reports it. */
export const alertKey = (e: GlobalEvent) => (e.type === 'storm' ? `storm:${stormKey(e)}` : e.id);

export interface JobSummary { subscribers: number; emails: number; alerts: number; failures: string[]; feedFailures: string[] }

export interface JobDeps {
  db: Db;
  fetchEvents: (now: number) => Promise<{ events: GlobalEvent[]; failed: string[] }>;
  send: Sender;
  origin: string;
  secret: string;
  now?: number;
}

/**
 * One pass of the alert job: for every subscriber, find events that match a rule, were not emailed before,
 * and are not older than the rule itself; send them as a single email; remember them.
 */
export async function runAlertJob(d: JobDeps): Promise<JobSummary> {
  const now = d.now ?? Date.now();
  const summary: JobSummary = { subscribers: 0, emails: 0, alerts: 0, failures: [], feedFailures: [] };

  const subs = await listSubscribers(d.db);
  summary.subscribers = subs.length;
  if (subs.length === 0) { await pruneSent(d.db, now - 2 * ALERT_WINDOW_MS); return summary; }

  const { events, failed } = await d.fetchEvents(now);
  summary.feedFailures = failed;
  if (events.length === 0) return summary;

  for (const { user, rules } of subs) {
    try {
      const matches = findAlerts(rules, events, now).filter(a => shouldNotify(a.rule, a.event));
      if (!matches.length) continue;
      // The same storm can appear under two records; keep one alert per key.
      const byKey = new Map<string, WatchAlert>();
      for (const a of matches) if (!byKey.has(alertKey(a.event))) byKey.set(alertKey(a.event), a);
      const fresh = await unsentEventIds(d.db, user.id, [...byKey.keys()]);
      const alerts = [...byKey].filter(([k]) => fresh.has(k)).map(([, a]) => a);
      if (!alerts.length) continue;

      const unsub = await unsubscribeUrl(d.origin, d.secret, user.id);
      const res = await d.send(user.email, buildAlertEmail({ alerts, origin: d.origin, unsubscribeUrl: unsub, name: user.name }), unsubscribeHeaders(unsub));
      if (!res.ok) { summary.failures.push(`${user.id}: ${res.error ?? 'send failed'}`); continue; }   // retried on the next run
      await markSent(d.db, user.id, alerts.map(a => alertKey(a.event)), now);
      summary.emails += 1; summary.alerts += alerts.length;
    } catch (e) {
      summary.failures.push(`${user.id}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  await pruneSent(d.db, now - 2 * ALERT_WINDOW_MS);
  return summary;
}
