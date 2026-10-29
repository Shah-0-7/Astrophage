/** Small WebCrypto helpers (work on Cloudflare Workers, Node 20+ and browsers). */

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const b64urlDecodeToString = (s: string) => new TextDecoder().decode(b64urlDecode(s));

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64urlEncode(a);
}

export async function sha256b64url(input: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input))));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function hmac(secret: string, message: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(message))));
}

/** Constant-time check of an HMAC (WebCrypto's verify does the comparison). */
export async function hmacVerify(secret: string, message: string, sig: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), b64urlDecode(sig), enc.encode(message));
  } catch { return false; }
}
