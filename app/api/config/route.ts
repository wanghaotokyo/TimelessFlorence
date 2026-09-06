import { body, db, handler, json, runtime, sameOrigin, user, requireUser } from '@/lib/server';
export async function GET(req: Request) {
  return handler(async () => {
    const e = runtime();
    const u = await user(req);
    let prefs = {};
    if (u) {
      const row = await db().prepare('SELECT prefs FROM users WHERE id=?').bind(u.id).first<{ prefs: string | null }>();
      if (row?.prefs) { try { prefs = JSON.parse(row.prefs); } catch {} }
    }
    return json({ googleClientId: e.GOOGLE_CLIENT_ID ?? '', generationReady: Boolean(e.OPENAI_API_KEY && e.OPENAI_MODEL), user: u, prefs });
  });
}
export async function PATCH(req: Request) {
  return handler(async () => {
    sameOrigin(req);
    const u = await requireUser(req);
    const b = await body(req);
    const allowed: Record<string, unknown> = {};
    if ([2, 5, 15].includes(Number(b.duration))) allowed.duration = Number(b.duration);
    if (['edge', 'system'].includes(String(b.engine ?? ''))) allowed.engine = String(b.engine);
    if (!Object.keys(allowed).length) return json({ ok: true });
    const row = await db().prepare('SELECT prefs FROM users WHERE id=?').bind(u.id).first<{ prefs: string | null }>();
    let current: Record<string, unknown> = {};
    if (row?.prefs) { try { current = JSON.parse(row.prefs); } catch {} }
    const next = JSON.stringify({ ...current, ...allowed });
    await db().prepare('UPDATE users SET prefs=? WHERE id=?').bind(next, u.id).run();
    return json({ ok: true });
  });
}
