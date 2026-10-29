import { describe, it, expect } from 'vitest';
import { sign, unsign, createSession, sessionUserId, readCookie, safeReturnTo, sameOrigin, setCookie, SESSION_COOKIE } from '@/lib/server/session';

const SECRET = 'x'.repeat(40);
const req = (headers: Record<string, string>, url = 'https://app.test/api/x') => new Request(url, { headers });

describe('signed cookies', () => {
  it('round-trips a payload', async () => {
    const t = await sign({ a: 1, exp: 2_000_000_000 }, SECRET);
    expect(await unsign<{ a: number; exp: number }>(t, SECRET, 1_000_000_000)).toMatchObject({ a: 1 });
  });
  it('rejects tampering, a wrong secret, and expiry', async () => {
    const t = await sign({ a: 1, exp: 2_000_000_000 }, SECRET);
    const [body, sig] = t.split('.');
    expect(await unsign(`${body.slice(0, -2)}AA.${sig}`, SECRET, 1)).toBeNull();
    expect(await unsign(t, 'y'.repeat(40), 1)).toBeNull();
    expect(await unsign(t, SECRET, 2_000_000_001)).toBeNull();
    expect(await unsign('garbage', SECRET)).toBeNull();
    expect(await unsign(undefined, SECRET)).toBeNull();
    expect(await unsign(t, '')).toBeNull();
  });
});

describe('sessions', () => {
  it('reads the user id from the cookie', async () => {
    const tok = await createSession('u_1', SECRET);
    expect(await sessionUserId(req({ cookie: `a=b; ${SESSION_COOKIE}=${encodeURIComponent(tok)}` }), SECRET)).toBe('u_1');
    expect(await sessionUserId(req({}), SECRET)).toBeNull();
    expect(await sessionUserId(req({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(tok)}` }), 'z'.repeat(40))).toBeNull();
  });
  it('parses cookies', () => {
    expect(readCookie(req({ cookie: 'a=1; b=two%20words' }), 'b')).toBe('two words');
    expect(readCookie(req({ cookie: 'a=1' }), 'b')).toBeUndefined();
  });
  it('sets safe cookie attributes', () => {
    const c = setCookie('n', 'v', 60, true);
    expect(c).toContain('HttpOnly'); expect(c).toContain('SameSite=Lax'); expect(c).toContain('Secure');
    expect(setCookie('n', 'v', 60, false)).not.toContain('Secure');
  });
});

describe('request guards', () => {
  it('only allows same-origin state changes', () => {
    expect(sameOrigin(req({ origin: 'https://app.test' }))).toBe(true);
    expect(sameOrigin(req({ origin: 'https://evil.test' }))).toBe(false);
    expect(sameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(sameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(sameOrigin(req({}))).toBe(false);
  });
  it('keeps redirects on this site', () => {
    expect(safeReturnTo('/events?x=1')).toBe('/events?x=1');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, undefined, '/a\r\nSet-Cookie: x=1']) expect(safeReturnTo(bad)).toBe('/app');
  });
});
