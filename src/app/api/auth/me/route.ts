/** GET /api/auth/me – who is signed in, and whether accounts / email are set up on this deployment. */
import { json } from '@/lib/server/api';
import { authConfigured, emailConfigured, serverEnv } from '@/lib/server/env';
import { sessionUserId } from '@/lib/server/session';
import { getRules, getUser } from '@/lib/server/store';

export async function GET(req: Request) {
  const env = await serverEnv();
  if (!authConfigured(env)) return json({ configured: false, emailConfigured: false, user: null });
  const id = await sessionUserId(req, env.SESSION_SECRET!);
  const user = id ? await getUser(env.DB!, id) : null;
  return json({ configured: true, emailConfigured: emailConfigured(env), user, rules: user ? await getRules(env.DB!, user.id) : [] });
}
