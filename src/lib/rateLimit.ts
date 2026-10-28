/**
 * rateLimit – small fixed-window limiter keyed by client address.
 * In-memory, so on a serverless / edge runtime each instance counts separately: it blunts bursts and accidental
 * loops, it is not a substitute for a shared limiter (Cloudflare rate-limiting rules or Redis) against determined abuse.
 */
const hits = new Map<string, { count: number; reset: number }>();

export interface LimitResult { ok: boolean; retryAfterSec: number }

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): LimitResult {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset <= now) { hits.set(key, { count: 1, reset: now + windowMs }); return { ok: true, retryAfterSec: 0 }; }
  cur.count += 1;
  return cur.count <= max ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.reset - now) / 1000)) };
}

export function clientKey(req: Request): string {
  const h = req.headers;
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export function _resetRateLimit() { hits.clear(); }
