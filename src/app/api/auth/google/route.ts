/** GET /api/auth/google?returnTo=/path – start Google sign-in (authorization code + PKCE). */
import { context } from '@/lib/server/api';
import { buildAuthUrl, newPkce } from '@/lib/server/google';
import { OAUTH_COOKIE, OAUTH_TTL_S, isHttps, safeReturnTo, setCookie, sign } from '@/lib/server/session';
import { randomToken } from '@/lib/server/crypto';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export async function GET(req: Request) {
  const c = await context(req);
  if (c instanceof Response) return c;
  if (!rateLimit(`login:${clientKey(req)}`, 20, 60_000).ok) return new Response('Too many attempts', { status: 429 });

  const url = new URL(req.url);
  const state = randomToken(24), nonce = randomToken(24), pkce = await newPkce();
  const cookie = await sign({ s: state, n: nonce, v: pkce.verifier, r: safeReturnTo(url.searchParams.get('returnTo')), exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_S }, c.secret);
  const dest = buildAuthUrl({ clientId: c.env.GOOGLE_CLIENT_ID!, redirectUri: `${c.origin}/api/auth/google/callback`, state, nonce, challenge: pkce.challenge });
  return new Response(null, { status: 302, headers: { Location: dest, 'Set-Cookie': setCookie(OAUTH_COOKIE, cookie, OAUTH_TTL_S, isHttps(req)), 'Cache-Control': 'no-store' } });
}
