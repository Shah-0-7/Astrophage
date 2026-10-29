import { appOrigin, authConfigured, serverEnv, type ServerEnv } from './env';
import type { Db } from './db';
import { sameOrigin, sessionUserId } from './session';
import { getUser, type User } from './store';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const fail = (status: number, error: string, headers: Record<string, string> = {}) => json({ error }, status, headers);

export interface Ctx { env: ServerEnv; db: Db; secret: string; origin: string }

/** The request's server context, or a 503 response when accounts are not configured on this deployment. */
export async function context(req: Request): Promise<Ctx | Response> {
  const env = await serverEnv();
  if (!authConfigured(env)) return fail(503, 'Accounts are not set up on this deployment.');
  return { env, db: env.DB!, secret: env.SESSION_SECRET!, origin: appOrigin(env, req) };
}

/** Context plus the signed-in user (401 if there is none). `write` also enforces same-origin and a rate limit. */
export async function requireUser(req: Request, write = false): Promise<(Ctx & { user: User }) | Response> {
  const c = await context(req);
  if (c instanceof Response) return c;
  if (write && !sameOrigin(req)) return fail(403, 'Cross-site request refused.');
  const id = await sessionUserId(req, c.secret);
  const user = id ? await getUser(c.db, id) : null;
  if (!user) return fail(401, 'Sign in required.');
  if (write) {
    const r = rateLimit(`w:${user.id}`, 60, 60_000);
    if (!r.ok) return fail(429, 'Too many requests.', { 'Retry-After': String(r.retryAfterSec) });
  }
  return { ...c, user };
}

/** Read a JSON body with a size cap. */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown | null> {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text);
  } catch { return null; }
}

export { clientKey, rateLimit };
