/**
 * POST/GET /api/cron/alerts – run one pass of the alert job. Called every few minutes by the Cloudflare Cron Trigger
 * (see worker.ts), and protected by `Authorization: Bearer $CRON_SECRET`.
 */
import { fail, json } from '@/lib/server/api';
import { hmac } from '@/lib/server/crypto';
import { runAlertJob } from '@/lib/server/alertJob';
import { appOrigin, authConfigured, emailConfigured, serverEnv } from '@/lib/server/env';
import { fetchAlertFeeds } from '@/lib/server/feeds';
import { resendSender } from '@/lib/server/mailer';

async function run(req: Request) {
  const env = await serverEnv();
  if (!authConfigured(env) || !emailConfigured(env) || !env.CRON_SECRET) return fail(503, 'Alerts are not configured.');
  const got = req.headers.get('authorization') ?? '';
  // Compare HMACs of both values so the check takes the same time wherever they differ.
  if ((await hmac(env.SESSION_SECRET!, got)) !== (await hmac(env.SESSION_SECRET!, `Bearer ${env.CRON_SECRET}`))) return fail(401, 'Unauthorized');
  const summary = await runAlertJob({ db: env.DB!, fetchEvents: now => fetchAlertFeeds(now), send: resendSender(env), origin: appOrigin(env, req), secret: env.SESSION_SECRET! });
  if (summary.failures.length || summary.feedFailures.length) console.warn('[cron/alerts]', JSON.stringify(summary));
  return json(summary);
}
export const GET = run;
export const POST = run;
