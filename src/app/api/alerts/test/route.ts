/** POST /api/alerts/test – send the signed-in user a test email. */
import { fail, json, rateLimit, requireUser } from '@/lib/server/api';
import { buildTestEmail } from '@/lib/server/alertEmail';
import { emailConfigured } from '@/lib/server/env';
import { resendSender, unsubscribeHeaders } from '@/lib/server/mailer';
import { getRules } from '@/lib/server/store';
import { unsubscribeUrl } from '@/lib/server/unsub';

export async function POST(req: Request) {
  const c = await requireUser(req, true);
  if (c instanceof Response) return c;
  if (!emailConfigured(c.env)) return fail(503, 'Email sending is not set up on this deployment.');
  const r = rateLimit(`test:${c.user.id}`, 3, 3600_000);
  if (!r.ok) return fail(429, 'You can send three test emails an hour.', { 'Retry-After': String(r.retryAfterSec) });
  const unsub = await unsubscribeUrl(c.origin, c.secret, c.user.id);
  const res = await resendSender(c.env)(c.user.email, buildTestEmail({ origin: c.origin, unsubscribeUrl: unsub, ruleCount: (await getRules(c.db, c.user.id)).length }), unsubscribeHeaders(unsub));
  if (!res.ok) { console.error('[alerts/test]', res.error); return fail(502, 'The email provider refused the message. Check the sender address and API key.'); }
  return json({ ok: true, to: c.user.email });
}
