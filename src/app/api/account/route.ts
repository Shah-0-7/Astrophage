/** PATCH /api/account { emailAlerts } – turn email alerts on or off. DELETE – remove the account and all its data. */
import { fail, json, readJson, requireUser } from '@/lib/server/api';
import { SESSION_COOKIE, clearCookie, isHttps } from '@/lib/server/session';
import { deleteUser, getUser, setEmailAlerts } from '@/lib/server/store';

export async function PATCH(req: Request) {
  const c = await requireUser(req, true);
  if (c instanceof Response) return c;
  const body = (await readJson(req)) as { emailAlerts?: unknown } | null;
  if (!body || typeof body.emailAlerts !== 'boolean') return fail(400, 'Expected { emailAlerts: boolean }.');
  await setEmailAlerts(c.db, c.user.id, body.emailAlerts);
  return json({ user: await getUser(c.db, c.user.id) });
}

export async function DELETE(req: Request) {
  const c = await requireUser(req, true);
  if (c instanceof Response) return c;
  await deleteUser(c.db, c.user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE, isHttps(req)) });
}
