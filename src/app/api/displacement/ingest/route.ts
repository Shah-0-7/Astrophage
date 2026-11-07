/**
 * POST /api/displacement/ingest – store one measured grid. Used by tools/nisar-grid (and its GitHub Action), never by
 * the browser. Protected by `Authorization: Bearer $INGEST_SECRET`. DELETE ?id= removes a grid.
 */
import { fail, json, readJson } from '@/lib/server/api';
import { hmac } from '@/lib/server/crypto';
import { validateWire } from '@/lib/displacement/field';
import { deleteField, saveField } from '@/lib/server/displacementStore';
import { serverEnv } from '@/lib/server/env';
import { clientKey, rateLimit } from '@/lib/rateLimit';

async function authorised(req: Request, secret: string): Promise<boolean> {
  const got = req.headers.get('authorization') ?? '';
  // Compare HMACs of both values so the check takes the same time wherever they differ.
  return (await hmac(secret, got)) === (await hmac(secret, `Bearer ${secret}`));
}

export async function POST(req: Request) {
  const env = await serverEnv();
  if (!env.DB || !env.INGEST_SECRET) return fail(503, 'Displacement ingest is not configured.');
  const lim = rateLimit(`ingest:${clientKey(req)}`, 30, 60_000);
  if (!lim.ok) return fail(429, 'Too many requests.', { 'Retry-After': String(lim.retryAfterSec) });
  if (!(await authorised(req, env.INGEST_SECRET))) return fail(401, 'Unauthorized');
  const body = await readJson(req, 700 * 1024);
  if (body === null) return fail(400, 'Body must be JSON under 700 KB.');
  const v = validateWire(body);
  if (!v.ok) return fail(400, v.error);
  await saveField(env.DB, v.wire);
  return json({ ok: true, id: v.wire.id });
}

export async function DELETE(req: Request) {
  const env = await serverEnv();
  if (!env.DB || !env.INGEST_SECRET) return fail(503, 'Displacement ingest is not configured.');
  if (!(await authorised(req, env.INGEST_SECRET))) return fail(401, 'Unauthorized');
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_.\-]{3,200}$/.test(id)) return fail(400, 'Bad id.');
  await deleteField(env.DB, id);
  return json({ ok: true });
}
