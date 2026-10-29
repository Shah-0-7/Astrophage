/**
 * /api/alerts/unsubscribe?u=<userId>&t=<token>
 * GET shows a confirmation page (so mail scanners that prefetch links cannot unsubscribe anyone);
 * POST performs it, including the RFC 8058 one-click request mail clients send.
 */
import { context } from '@/lib/server/api';
import { esc } from '@/lib/server/alertEmail';
import { setEmailAlerts } from '@/lib/server/store';
import { verifyUnsubToken } from '@/lib/server/unsub';

const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="margin:0;background:#000;color:#fff;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:24px"><p style="letter-spacing:.2em;font-size:12px;color:#9a9aa5">ASTROPHAGE</p><h1 style="font-size:22px;margin:.4em 0">${esc(title)}</h1>${body}</main>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

async function valid(req: Request) {
  const c = await context(req);
  if (c instanceof Response) return null;
  const sp = new URL(req.url).searchParams, u = sp.get('u') ?? '', t = sp.get('t') ?? '';
  return u && t && (await verifyUnsubToken(c.secret, u, t)) ? { c, u } : null;
}

export async function GET(req: Request) {
  const v = await valid(req);
  if (!v) return page('This link is not valid', '<p>It may be incomplete or out of date. You can turn email alerts off from the bell panel in Astrophage.</p>', 400);
  const q = new URL(req.url).search;
  return page('Stop alert emails?', `<p>You will stop getting watchlist emails. Your rules stay saved, and you can turn emails back on from the bell panel.</p><form method="post" action="/api/alerts/unsubscribe${esc(q)}"><button style="font:inherit;color:#000;background:#fff;border:0;border-radius:999px;padding:12px 22px;cursor:pointer">Stop emails</button></form>`);
}

export async function POST(req: Request) {
  const v = await valid(req);
  if (!v) return page('This link is not valid', '<p>It may be incomplete or out of date.</p>', 400);
  await setEmailAlerts(v.c.db, v.u, false);
  return page('Emails stopped', '<p>You will not get more alert emails. You can turn them back on any time from the bell panel in Astrophage.</p>');
}
