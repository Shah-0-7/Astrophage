import { b64urlDecodeToString, b64urlEncode, hmac, hmacVerify } from './crypto';

/**
 * Stateless signed cookies: `base64url(json).hmac`. Used for the login session and for the short-lived
 * OAuth state. HttpOnly + SameSite=Lax; `Secure` is added whenever the request came over https.
 */

export const SESSION_COOKIE = 'ob_session';
export const OAUTH_COOKIE = 'ob_oauth';
export const SESSION_TTL_S = 30 * 24 * 3600;
export const OAUTH_TTL_S = 10 * 60;

export async function sign<T extends object>(payload: T, secret: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}

/** Returns the payload if the signature is valid and `exp` (epoch seconds) has not passed. */
export async function unsign<T extends { exp?: number }>(token: string | undefined | null, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<T | null> {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!(await hmacVerify(secret, body, sig))) return null;
  try {
    const p = JSON.parse(b64urlDecodeToString(body)) as T;
    if (typeof p.exp !== 'number' || p.exp <= nowS) return null;
    return p;
  } catch { return null; }
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function isHttps(req: Request): boolean {
  try { return new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'; } catch { return false; }
}

export function setCookie(name: string, value: string, maxAgeS: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export const clearCookie = (name: string, secure: boolean) => setCookie(name, '', 0, secure);

export interface SessionPayload { u: string; exp: number }

export const createSession = (userId: string, secret: string, nowS = Math.floor(Date.now() / 1000)) =>
  sign<SessionPayload>({ u: userId, exp: nowS + SESSION_TTL_S }, secret);

export async function sessionUserId(req: Request, secret: string): Promise<string | null> {
  const p = await unsign<SessionPayload>(readCookie(req, SESSION_COOKIE), secret);
  return p?.u ?? null;
}

/**
 * CSRF guard for state-changing requests: the cookie is SameSite=Lax already, and on top of that we require a
 * same-origin `Origin` (or `Sec-Fetch-Site`) header. Requests with neither header (curl, server-to-server) are refused.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin) { try { return new URL(origin).host === new URL(req.url).host; } catch { return false; } }
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin';
}

/** Only allow redirects to a path on this site. */
export function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\r\n]/.test(v)) return '/app';
  return v;
}
