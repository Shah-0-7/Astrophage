import type { ServerEnv } from './env';
import type { BuiltEmail } from './alertEmail';

export interface SendResult { ok: boolean; error?: string }
export type Sender = (to: string, mail: BuiltEmail, extraHeaders?: Record<string, string>) => Promise<SendResult>;

/** Sends through Resend's HTTP API (works on Workers: plain fetch, no SMTP). */
export function resendSender(env: ServerEnv, f: typeof fetch = fetch): Sender {
  return async (to, mail, extraHeaders) => {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false, error: 'Email is not configured (RESEND_API_KEY / EMAIL_FROM).' };
    try {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text, headers: extraHeaders }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'send failed' }; }
  };
}

/** RFC 8058 one-click unsubscribe headers (Gmail and Yahoo expect these for bulk-ish mail). */
export const unsubscribeHeaders = (url: string) => ({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
