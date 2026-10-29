import { b64urlDecode, b64urlDecodeToString, b64urlEncode, randomToken, sha256b64url } from './crypto';

/** Google sign-in: OpenID Connect authorization-code flow with PKCE and a nonce. */

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

export interface PkcePair { verifier: string; challenge: string }
export async function newPkce(): Promise<PkcePair> {
  const verifier = randomToken(48);
  return { verifier, challenge: await sha256b64url(verifier) };
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: 'code',
    scope: 'openid email profile', state: o.state, nonce: o.nonce,
    code_challenge: o.challenge, code_challenge_method: 'S256',
    prompt: 'select_account', access_type: 'online',
  });
  return `${GOOGLE_AUTH}?${q}`;
}

export async function exchangeCode(o: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }, f: typeof fetch = fetch): Promise<string> {
  const res = await f(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: o.clientId, client_secret: o.clientSecret, code: o.code, code_verifier: o.verifier,
      grant_type: 'authorization_code', redirect_uri: o.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token endpoint ${res.status}`);
  const j = (await res.json()) as { id_token?: string };
  if (!j.id_token) throw new Error('Google token response had no id_token');
  return j.id_token;
}

export interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

let jwksCache: { at: number; keys: Jwk[] } | null = null;
export const _resetJwksCache = () => { jwksCache = null; };
export async function fetchJwks(f: typeof fetch = fetch): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await f(GOOGLE_JWKS, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Google JWKS ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys ?? [];
  jwksCache = { at: Date.now(), keys };
  return keys;
}

export interface GoogleProfile { sub: string; email: string; name: string; picture: string }

/** Verifies signature (RS256 against Google's keys), issuer, audience, expiry, nonce, and that the email is verified. */
export async function verifyIdToken(
  idToken: string,
  o: { clientId: string; nonce: string; nowS?: number },
  getKeys: () => Promise<Jwk[]> = fetchJwks,
): Promise<GoogleProfile> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const [h, p, s] = parts;
  const header = JSON.parse(b64urlDecodeToString(h)) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('Unexpected id_token algorithm');
  const jwk = (await getKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown id_token key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Bad id_token signature');

  const c = JSON.parse(b64urlDecodeToString(p)) as Record<string, unknown>;
  const now = o.nowS ?? Math.floor(Date.now() / 1000);
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new Error('Wrong issuer');
  if (c.aud !== o.clientId) throw new Error('Wrong audience');
  if (typeof c.exp !== 'number' || c.exp <= now) throw new Error('Expired id_token');
  if (c.nonce !== o.nonce) throw new Error('Nonce mismatch');
  if (c.email_verified !== true || typeof c.email !== 'string' || typeof c.sub !== 'string') throw new Error('Google account email is not verified');
  return {
    sub: c.sub, email: c.email.toLowerCase(),
    name: typeof c.name === 'string' ? c.name.slice(0, 120) : '',
    picture: typeof c.picture === 'string' && c.picture.startsWith('https://') ? c.picture.slice(0, 500) : '',
  };
}

export { b64urlEncode };
