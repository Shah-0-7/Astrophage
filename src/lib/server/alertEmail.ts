import type { GlobalEvent } from '@/lib/globalEvents';
import type { WatchAlert } from '@/lib/watchlist';
import { alertText } from '@/lib/watchlist';
import { classifyStorm, fmtWind } from '@/lib/stormScale';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';

/** Feed text is untrusted: escape everything that goes into the HTML body. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only http(s) links go into the email. */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : '');

export const MAX_ITEMS = 12;

export interface BuiltEmail { subject: string; html: string; text: string }

function detail(e: GlobalEvent): string {
  const when = new Date(e.time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const where = `${Math.abs(e.lat).toFixed(2)}°${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(2)}°${e.lon >= 0 ? 'E' : 'W'}`;
  const bits = [EVENT_TYPE_CONFIG[e.type]?.label ?? e.type, when, where];
  if (e.type === 'storm') {
    const c = classifyStorm(e.wind_kts, e.lat, e.lon);
    if (c) bits.splice(1, 0, `${c.full}${e.wind_kts != null ? `, ${fmtWind(e.wind_kts)}` : ''}`);
  } else if (e.depth != null) bits.push(`depth ${Math.round(e.depth)} km`);
  return bits.join(' · ');
}

/** One email for everything new since the last run, so a burst of events never means a burst of emails. */
export function buildAlertEmail(o: { alerts: WatchAlert[]; origin: string; unsubscribeUrl: string; name?: string }): BuiltEmail {
  const { alerts, origin, unsubscribeUrl } = o;
  const shown = alerts.slice(0, MAX_ITEMS), more = alerts.length - shown.length;
  const first = alertText(alerts[0].event);
  const subject = alerts.length === 1 ? `${first.title} · ${first.body}`.slice(0, 120) : `${alerts.length} new events match your Astrophage watchlist`;
  const ledger = (e: GlobalEvent) => `${origin}/events?event=${encodeURIComponent(e.id)}`;

  const text = [
    alerts.length === 1 ? 'A new event matches your watchlist:' : `${alerts.length} new events match your watchlist:`,
    '',
    ...shown.flatMap(({ event: e, rule }) => {
      const t = alertText(e);
      return [`${t.title} — ${t.body}`, `  ${detail(e)}`, `  Rule: ${rule.name || 'unnamed'}`, `  ${ledger(e)}`, ''];
    }),
    ...(more > 0 ? [`…and ${more} more. Open Astrophage to see them all: ${origin}/events`, ''] : []),
    `Stop these emails: ${unsubscribeUrl}`,
    'You get this because you turned on email alerts in Astrophage. Magnitudes and categories come from USGS, NASA EONET and GDACS and can be revised.',
  ].join('\n');

  const items = shown.map(({ event: e, rule }) => {
    const t = alertText(e), color = EVENT_TYPE_CONFIG[e.type]?.color ?? '#888';
    const src = safeUrl(e.source_url);
    return `<tr><td style="padding:14px 0;border-bottom:1px solid #26262c">
<div style="font:700 20px Arial,sans-serif;color:${color}">${esc(t.title)}</div>
<div style="font:600 15px Arial,sans-serif;color:#f4f4f5;margin-top:2px">${esc(t.body)}</div>
<div style="font:12px Arial,sans-serif;color:#9a9aa5;margin-top:4px">${esc(detail(e))}</div>
<div style="font:12px Arial,sans-serif;color:#9a9aa5;margin-top:2px">Rule: ${esc(rule.name || 'unnamed')}</div>
<div style="margin-top:8px;font:13px Arial,sans-serif"><a href="${esc(ledger(e))}" style="color:#ffb28f">Open in Astrophage</a>${src ? ` &nbsp;·&nbsp; <a href="${esc(src)}" style="color:#9a9aa5">Source</a>` : ''}</div>
</td></tr>`;
  }).join('');

  const html = `<!doctype html><html><body style="margin:0;background:#000;padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#0b0b0f;border:1px solid #26262c;border-radius:14px"><tr><td style="padding:22px 24px">
<div style="font:700 13px Arial,sans-serif;letter-spacing:.22em;color:#ffffff">ASTROPHAGE</div>
<div style="font:15px Arial,sans-serif;color:#d4d4d8;margin:14px 0 4px">${alerts.length === 1 ? 'A new event matches your watchlist' : `${alerts.length} new events match your watchlist`}</div>
<table role="presentation" width="100%">${items}</table>
${more > 0 ? `<p style="font:13px Arial,sans-serif;color:#d4d4d8">…and ${more} more. <a href="${esc(origin)}/events" style="color:#ffb28f">See all events</a></p>` : ''}
<p style="font:11px/1.5 Arial,sans-serif;color:#74747f;margin:18px 0 0">You get this because you turned on email alerts in Astrophage. Magnitudes and categories come from USGS, NASA EONET and GDACS and can be revised.<br><a href="${esc(unsubscribeUrl)}" style="color:#9a9aa5">Stop these emails</a></p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}

export function buildTestEmail(o: { origin: string; unsubscribeUrl: string; ruleCount: number }): BuiltEmail {
  const n = o.ruleCount;
  const line = n ? `You have ${n} watch rule${n === 1 ? '' : 's'} saved. When a new event matches one, you will get an email like this.` : 'You have no watch rules yet. Add one in the bell panel and matching events will arrive by email.';
  return {
    subject: 'Astrophage test email: alerts are working',
    text: `This is a test from Astrophage.\n\n${line}\n\nStop these emails: ${o.unsubscribeUrl}\n`,
    html: `<!doctype html><html><body style="margin:0;background:#000;padding:24px 12px"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#0b0b0f;border:1px solid #26262c;border-radius:14px"><tr><td style="padding:22px 24px"><div style="font:700 13px Arial,sans-serif;letter-spacing:.22em;color:#fff">ASTROPHAGE</div><p style="font:15px/1.5 Arial,sans-serif;color:#d4d4d8">This is a test email: alerts are working.</p><p style="font:13px/1.5 Arial,sans-serif;color:#9a9aa5">${esc(line)}</p><p style="font:11px Arial,sans-serif;color:#74747f"><a href="${esc(o.unsubscribeUrl)}" style="color:#9a9aa5">Stop these emails</a></p></td></tr></table></body></html>`,
  };
}
