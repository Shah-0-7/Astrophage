/** GET /api/watch/rules – the signed-in user's saved rules. PUT replaces them (body: { rules: WatchRule[] }). */
import { fail, json, readJson, requireUser } from '@/lib/server/api';
import { getRules, replaceRules } from '@/lib/server/store';

export async function GET(req: Request) {
  const c = await requireUser(req);
  if (c instanceof Response) return c;
  return json({ rules: await getRules(c.db, c.user.id) });
}

export async function PUT(req: Request) {
  const c = await requireUser(req, true);
  if (c instanceof Response) return c;
  const body = (await readJson(req)) as { rules?: unknown } | null;
  if (!body || !Array.isArray(body.rules)) return fail(400, 'Expected { rules: [...] }.');
  return json({ rules: await replaceRules(c.db, c.user.id, body.rules as never) });
}
