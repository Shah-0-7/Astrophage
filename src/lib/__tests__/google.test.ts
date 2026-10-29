import { describe, it, expect } from 'vitest';
import { b64urlEncode } from '@/lib/server/crypto';
import { buildAuthUrl, newPkce, verifyIdToken, type Jwk } from '@/lib/server/google';
import { sha256b64url } from '@/lib/server/crypto';

const CLIENT = 'client-123.apps.googleusercontent.com';
const NOW = 1_800_000_000;

async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as Jwk;
  return { priv: kp.privateKey, jwk: { ...jwk, kid: 'k1' } };
}
async function token(priv: CryptoKey, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) {
  const h = b64urlEncode(JSON.stringify(header)), p = b64urlEncode(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}
const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: NOW + 600, nonce: 'n1', sub: '123', email: 'Me@Example.com', email_verified: true, name: 'Me', picture: 'https://lh3.googleusercontent.com/a' };

describe('verifyIdToken', () => {
  it('accepts a valid token and normalises the email', async () => {
    const { priv, jwk } = await keypair();
    const p = await verifyIdToken(await token(priv, good), { clientId: CLIENT, nonce: 'n1', nowS: NOW }, async () => [jwk]);
    expect(p).toEqual({ sub: '123', email: 'me@example.com', name: 'Me', picture: 'https://lh3.googleusercontent.com/a' });
  });
  it.each([
    ['wrong audience', { aud: 'other' }],
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['expired', { exp: NOW - 1 }],
    ['wrong nonce', { nonce: 'nope' }],
    ['unverified email', { email_verified: false }],
    ['missing email', { email: undefined }],
  ])('rejects %s', async (_n, patch) => {
    const { priv, jwk } = await keypair();
    await expect(verifyIdToken(await token(priv, { ...good, ...patch }), { clientId: CLIENT, nonce: 'n1', nowS: NOW }, async () => [jwk])).rejects.toThrow();
  });
  it('rejects a token signed by a different key, an unknown kid, and alg=none', async () => {
    const a = await keypair(), b = await keypair();
    const opts = { clientId: CLIENT, nonce: 'n1', nowS: NOW };
    await expect(verifyIdToken(await token(b.priv, good), opts, async () => [a.jwk])).rejects.toThrow(/signature/);
    await expect(verifyIdToken(await token(a.priv, good, { alg: 'RS256', kid: 'other' }), opts, async () => [a.jwk])).rejects.toThrow(/key/);
    await expect(verifyIdToken(await token(a.priv, good, { alg: 'none', kid: 'k1' }), opts, async () => [a.jwk])).rejects.toThrow(/algorithm/);
    await expect(verifyIdToken('a.b', opts, async () => [a.jwk])).rejects.toThrow();
  });
  it('does not keep an untrusted picture URL', async () => {
    const { priv, jwk } = await keypair();
    const p = await verifyIdToken(await token(priv, { ...good, picture: 'javascript:alert(1)' }), { clientId: CLIENT, nonce: 'n1', nowS: NOW }, async () => [jwk]);
    expect(p.picture).toBe('');
  });
});

describe('authorization request', () => {
  it('uses PKCE S256 with state and nonce', async () => {
    const pk = await newPkce();
    expect(pk.challenge).toBe(await sha256b64url(pk.verifier));
    const u = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'https://app.test/api/auth/google/callback', state: 's', nonce: 'n', challenge: pk.challenge }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('s'); expect(u.searchParams.get('nonce')).toBe('n');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
});
