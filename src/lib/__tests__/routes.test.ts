import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testDb } from './_d1';
import { __setServerEnvForTests } from '@/lib/server/env';
import { b64urlEncode } from '@/lib/server/crypto';
import { _resetJwksCache } from '@/lib/server/google';
import { OAUTH_COOKIE, SESSION_COOKIE, createSession } from '@/lib/server/session';
import { upsertUser, getRules, getUser } from '@/lib/server/store';
import { unsubToken } from '@/lib/server/unsub';
import { newRule } from '@/lib/watchlist';
import { _resetRateLimit } from '@/lib/rateLimit';
import * as login from '@/app/api/auth/google/route';
import * as callback from '@/app/api/auth/google/callback/route';
import * as me from '@/app/api/auth/me/route';
import * as logout from '@/app/api/auth/logout/route';
import * as rules from '@/app/api/watch/rules/route';
import * as account from '@/app/api/account/route';
import * as unsub from '@/app/api/alerts/unsubscribe/route';
import * as cron from '@/app/api/cron/alerts/route';

const SECRET = 's'.repeat(40);
const ORIGIN = 'https://app.test';
const CLIENT = 'cid.apps.googleusercontent.com';
let db: ReturnType<typeof testDb>;

const env = () => ({ DB: db, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'gsecret', SESSION_SECRET: SECRET, RESEND_API_KEY: 're_x', EMAIL_FROM: 'Astrophage <alerts@app.test>', CRON_SECRET: 'cron-secret' });
const call = (h: (r: Request) => Promise<Response>, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers); if (init.cookie) headers.set('cookie', init.cookie);
  return h(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const setCookies = (r: Response) => (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]);
const cookieVal = (r: Response, name: string) => decodeURIComponent((setCookies(r).find(c => c.startsWith(`${name}=`)) ?? '').slice(name.length + 1));

async function signedIn(sub = 'g1', email = 'me@example.com') {
  const user = await upsertUser(db, { sub, email, name: 'Me', picture: '' });
  return { user, cookie: `${SESSION_COOKIE}=${encodeURIComponent(await createSession(user.id, SECRET))}` };
}
const sameOriginHeaders = { origin: ORIGIN, 'content-type': 'application/json' };

beforeEach(() => { db = testDb(); __setServerEnvForTests(env()); _resetRateLimit(); _resetJwksCache(); });
afterEach(() => { __setServerEnvForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('configuration', () => {
  it('reports accounts as unavailable when not configured', async () => {
    __setServerEnvForTests({});
    const r = await call(me.GET, '/api/auth/me');
    expect(await r.json()).toMatchObject({ configured: false, user: null });
    expect((await call(login.GET, '/api/auth/google')).status).toBe(503);
  });
});

describe('Google sign-in flow', () => {
  it('redirects to Google with PKCE and sets a signed state cookie', async () => {
    const r = await call(login.GET, '/api/auth/google?returnTo=/events');
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get('location')!);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toContain(`${OAUTH_COOKIE}=`); expect(sc).toContain('HttpOnly'); expect(sc).toContain('Secure');
  });

  async function startAndFinish(opts: { state?: string; nonce?: string; cookie?: boolean } = {}) {
    const start = await call(login.GET, '/api/auth/google?returnTo=/events');
    const u = new URL(start.headers.get('location')!);
    const oauthCookie = `${OAUTH_COOKIE}=${encodeURIComponent(cookieVal(start, OAUTH_COOKIE))}`;
    const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
    const claims = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, nonce: opts.nonce ?? u.searchParams.get('nonce'), sub: 'google-123', email: 'Person@Example.com', email_verified: true, name: 'Person', picture: 'https://lh3.googleusercontent.com/p' };
    const h = b64urlEncode(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64urlEncode(JSON.stringify(claims));
    const idToken = `${h}.${p}.${b64urlEncode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`))))}`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com/token')) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('code_verifier')).toBeTruthy(); expect(body.get('client_secret')).toBe('gsecret');
        return new Response(JSON.stringify({ id_token: idToken }));
      }
      return new Response(JSON.stringify({ keys: [jwk] }));
    }));
    const res = await call(callback.GET, `/api/auth/google/callback?code=abc&state=${opts.state ?? u.searchParams.get('state')}`, { cookie: opts.cookie === false ? undefined : oauthCookie });
    return { res, calls };
  }

  it('creates the account, starts a session and returns to the page', async () => {
    const { res } = await startAndFinish();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events?auth=ok`);
    const session = cookieVal(res, SESSION_COOKIE);
    expect(session).toBeTruthy();
    const who = await (await call(me.GET, '/api/auth/me', { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` })).json();
    expect(who.user).toMatchObject({ email: 'person@example.com', emailAlerts: true });
    expect(who.emailConfigured).toBe(true);
  });
  it('refuses a mismatched state (CSRF) and a missing state cookie', async () => {
    const bad = await startAndFinish({ state: 'forged' });
    expect(bad.res.headers.get('location')).toContain('auth=failed'); expect(cookieVal(bad.res, SESSION_COOKIE)).toBe('');
    const none = await startAndFinish({ cookie: false });
    expect(none.res.headers.get('location')).toContain('auth=failed'); expect(cookieVal(none.res, SESSION_COOKIE)).toBe('');
  });
  it('refuses a token whose nonce does not match', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await startAndFinish({ nonce: 'someone-elses' });
    expect(r.res.headers.get('location')).toContain('auth=failed'); expect(cookieVal(r.res, SESSION_COOKIE)).toBe('');
    expect(errSpy.mock.calls.flat().join(' ')).toContain('Nonce mismatch');
  });
  it('handles the user cancelling at Google', async () => {
    const start = await call(login.GET, '/api/auth/google?returnTo=/events');
    const res = await call(callback.GET, '/api/auth/google/callback?error=access_denied', { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(cookieVal(start, OAUTH_COOKIE))}` });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/events?auth=cancelled`);
  });
  it('never redirects off-site, whatever returnTo says', async () => {
    const start = await call(login.GET, '/api/auth/google?returnTo=https://evil.test/');
    const res = await call(callback.GET, '/api/auth/google/callback?error=x', { cookie: `${OAUTH_COOKIE}=${encodeURIComponent(cookieVal(start, OAUTH_COOKIE))}` });
    expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN);
  });
});

describe('rules API', () => {
  it('needs a session', async () => {
    expect((await call(rules.GET, '/api/watch/rules')).status).toBe(401);
    expect((await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: sameOriginHeaders, body: '{"rules":[]}' })).status).toBe(401);
  });
  it('saves, sanitises and returns the user\'s rules', async () => {
    const { user, cookie } = await signedIn();
    const body = JSON.stringify({ rules: [{ ...newRule({ name: 'Big', minMagnitude: 6.5 }) }, { types: ['bogus'], minMagnitude: 400 }] });
    const put = await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: sameOriginHeaders, body, cookie });
    expect(put.status).toBe(200);
    const got = await (await call(rules.GET, '/api/watch/rules', { cookie })).json();
    expect(got.rules).toHaveLength(2);
    expect(got.rules[1]).toMatchObject({ types: [], minMagnitude: 10 });
    expect(await getRules(db, user.id)).toHaveLength(2);
  });
  it('refuses cross-site writes and malformed bodies', async () => {
    const { cookie } = await signedIn();
    expect((await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: { origin: 'https://evil.test' }, body: '{"rules":[]}', cookie })).status).toBe(403);
    expect((await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: {}, body: '{"rules":[]}', cookie })).status).toBe(403);
    expect((await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: sameOriginHeaders, body: 'nope', cookie })).status).toBe(400);
    expect((await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: sameOriginHeaders, body: '{"rules":"x"}', cookie })).status).toBe(400);
  });
  it('rejects a forged session cookie', async () => {
    const forged = `${SESSION_COOKIE}=${encodeURIComponent(await createSession('u_x', 'z'.repeat(40)))}`;
    expect((await call(rules.GET, '/api/watch/rules', { cookie: forged })).status).toBe(401);
  });
});

describe('account', () => {
  it('toggles email alerts', async () => {
    const { user, cookie } = await signedIn();
    const r = await call(account.PATCH, '/api/account', { method: 'PATCH', headers: sameOriginHeaders, body: '{"emailAlerts":false}', cookie });
    expect((await r.json()).user.emailAlerts).toBe(false);
    expect((await getUser(db, user.id))!.emailAlerts).toBe(false);
    expect((await call(account.PATCH, '/api/account', { method: 'PATCH', headers: sameOriginHeaders, body: '{"emailAlerts":"yes"}', cookie })).status).toBe(400);
  });
  it('deletes everything and signs out', async () => {
    const { user, cookie } = await signedIn();
    await call(rules.PUT, '/api/watch/rules', { method: 'PUT', headers: sameOriginHeaders, body: JSON.stringify({ rules: [newRule({})] }), cookie });
    const r = await call(account.DELETE, '/api/account', { method: 'DELETE', headers: { origin: ORIGIN }, cookie });
    expect(r.status).toBe(200); expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await getUser(db, user.id)).toBeNull(); expect(await getRules(db, user.id)).toEqual([]);
  });
  it('logs out only for same-origin requests', async () => {
    expect((await call(logout.POST, '/api/auth/logout', { method: 'POST' })).status).toBe(403);
    const ok = await call(logout.POST, '/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN } });
    expect(ok.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('unsubscribe link', () => {
  it('confirms on GET, unsubscribes on POST, and rejects bad tokens', async () => {
    const { user } = await signedIn();
    const t = await unsubToken(SECRET, user.id);
    const q = `?u=${encodeURIComponent(user.id)}&t=${t}`;
    const page = await call(unsub.GET, `/api/alerts/unsubscribe${q}`);
    expect(page.status).toBe(200); expect(await page.text()).toContain('Stop alert emails?');
    expect((await getUser(db, user.id))!.emailAlerts).toBe(true);          // a prefetching scanner changed nothing
    expect((await call(unsub.POST, `/api/alerts/unsubscribe${q}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' })).status).toBe(200);
    expect((await getUser(db, user.id))!.emailAlerts).toBe(false);
    expect((await call(unsub.POST, `/api/alerts/unsubscribe?u=${user.id}&t=forged`, { method: 'POST' })).status).toBe(400);
    expect((await call(unsub.GET, '/api/alerts/unsubscribe')).status).toBe(400);
  });
});

describe('cron endpoint', () => {
  it('requires the bearer secret', async () => {
    expect((await call(cron.POST, '/api/cron/alerts', { method: 'POST' })).status).toBe(401);
    expect((await call(cron.POST, '/api/cron/alerts', { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await call(cron.POST, '/api/cron/alerts', { method: 'POST', headers: { authorization: 'Bearer cron-secret' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ subscribers: 0, emails: 0 });
  });
  it('is closed when email or the secret is not configured', async () => {
    __setServerEnvForTests({ ...env(), CRON_SECRET: undefined });
    expect((await call(cron.POST, '/api/cron/alerts', { method: 'POST', headers: { authorization: 'Bearer undefined' } })).status).toBe(503);
  });
});
