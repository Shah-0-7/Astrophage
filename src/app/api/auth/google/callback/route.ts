/** GET /api/auth/google/callback – finish sign-in: check state, exchange the code, verify the ID token, start a session. */
import { context } from '@/lib/server/api';
import { exchangeCode, verifyIdToken } from '@/lib/server/google';
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_TTL_S, clearCookie, createSession, isHttps, readCookie, safeReturnTo, setCookie, unsign } from '@/lib/server/session';
import { upsertUser } from '@/lib/server/store';

export async function GET(req: Request) {
  const c = await context(req);
  if (c instanceof Response) return c;
  const secure = isHttps(req);
  const back = (path: string, extra?: string) => {
    const h = new Headers({ Location: `${c.origin}${path}`, 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', clearCookie(OAUTH_COOKIE, secure));
    if (extra) h.append('Set-Cookie', extra);
    return new Response(null, { status: 302, headers: h });
  };

  const sp = new URL(req.url).searchParams;
  const saved = await unsign<{ s: string; n: string; v: string; r: string; exp: number }>(readCookie(req, OAUTH_COOKIE), c.secret);
  const dest = (q: string) => `${safeReturnTo(saved?.r)}${safeReturnTo(saved?.r).includes('?') ? '&' : '?'}${q}`;

  if (sp.get('error')) return back(dest('auth=cancelled'));
  const code = sp.get('code'), state = sp.get('state');
  if (!saved || !code || !state || state !== saved.s) return back('/app?auth=failed');

  try {
    const idToken = await exchangeCode({ clientId: c.env.GOOGLE_CLIENT_ID!, clientSecret: c.env.GOOGLE_CLIENT_SECRET!, redirectUri: `${c.origin}/api/auth/google/callback`, code, verifier: saved.v });
    const profile = await verifyIdToken(idToken, { clientId: c.env.GOOGLE_CLIENT_ID!, nonce: saved.n });
    const user = await upsertUser(c.db, profile);
    return back(dest('auth=ok'), setCookie(SESSION_COOKIE, await createSession(user.id, c.secret), SESSION_TTL_S, secure));
  } catch (e) {
    console.error('[auth/google/callback]', e instanceof Error ? e.message : e);
    return back(dest('auth=failed'));
  }
}
