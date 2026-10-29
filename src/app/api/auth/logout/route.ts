/** POST /api/auth/logout – clear the session cookie. */
import { fail } from '@/lib/server/api';
import { SESSION_COOKIE, clearCookie, isHttps, sameOrigin } from '@/lib/server/session';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'Cross-site request refused.');
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie(SESSION_COOKIE, isHttps(req)), 'Cache-Control': 'no-store' } });
}
