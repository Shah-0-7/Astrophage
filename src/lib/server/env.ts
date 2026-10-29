/**
 * Server configuration and bindings.
 *
 * On Cloudflare Workers (OpenNext) the D1 database is a binding and secrets are env vars; both come from
 * `getCloudflareContext().env`. In `next dev` and tests we fall back to `process.env` (and no database, unless injected).
 */
import type { Db } from './db';

export interface ServerEnv {
  DB?: Db;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  CRON_SECRET?: string;
  APP_URL?: string;
}

const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET', 'APP_URL'] as const;

let override: ServerEnv | null = null;
/** Test seam: route tests inject a database and secrets here. Never called in the app. */
export function __setServerEnvForTests(e: ServerEnv | null) { override = e; }

export async function serverEnv(): Promise<ServerEnv> {
  if (override) return override;
  const out: ServerEnv = {};
  let cf: Record<string, unknown> | undefined;
  try {
    const m = await import('@opennextjs/cloudflare');
    cf = (m.getCloudflareContext().env ?? undefined) as Record<string, unknown> | undefined;
  } catch { /* not running under the Cloudflare adapter */ }
  for (const k of KEYS) {
    const v = (cf?.[k] as string | undefined) ?? process.env[k];
    // Values still holding the placeholder text from wrangler.jsonc count as unset.
    if (typeof v === 'string' && v && !/REPLACE|your-verified-domain|your-site/i.test(v)) out[k] = v;
  }
  if (cf?.DB) out.DB = cf.DB as Db;
  return out;
}

/** Sign-in needs all three; the page shows the login button only when this is true. */
export const authConfigured = (e: ServerEnv) => !!(e.DB && e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.SESSION_SECRET && e.SESSION_SECRET.length >= 32);
export const emailConfigured = (e: ServerEnv) => !!(e.RESEND_API_KEY && e.EMAIL_FROM);

/** Public origin used in OAuth redirects and email links. APP_URL wins; otherwise the request's own origin. */
export function appOrigin(e: ServerEnv, req: Request): string {
  const base = e.APP_URL ?? new URL(req.url).origin;
  return base.replace(/\/+$/, '');
}
