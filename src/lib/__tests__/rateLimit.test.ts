import { beforeEach, describe, expect, it } from 'vitest';
import { _resetRateLimit, clientKey, rateLimit } from '../rateLimit';

beforeEach(_resetRateLimit);

describe('rateLimit', () => {
  it('allows up to the maximum, then blocks with a retry hint', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('a', 3, 60_000, 1000).ok).toBe(true);
    const r = rateLimit('a', 3, 60_000, 1000);
    expect(r.ok).toBe(false); expect(r.retryAfterSec).toBe(60);
  });
  it('resets after the window and keeps clients separate', () => {
    for (let i = 0; i < 4; i++) rateLimit('a', 3, 1000, 0);
    expect(rateLimit('b', 3, 1000, 0).ok).toBe(true);
    expect(rateLimit('a', 3, 1000, 1500).ok).toBe(true);
  });
  it('reads the client address from proxy headers', () => {
    expect(clientKey(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4');
    expect(clientKey(new Request('http://x', { headers: { 'cf-connecting-ip': '9.9.9.9' } }))).toBe('9.9.9.9');
    expect(clientKey(new Request('http://x'))).toBe('unknown');
  });
});
