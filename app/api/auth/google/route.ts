import { body, cookie, db, digest, handler, HttpError, json, runtime, sameOrigin, sessionCookie } from '@/lib/server';
import { verifyGoogle } from '@/lib/google';
export async function POST(req: Request) { return handler(async () => {
  sameOrigin(req); const client = runtime().GOOGLE_CLIENT_ID; if (!client) throw new HttpError(503, 'Google 登录尚未配置，请联系应用管理员。');
  const data = await body(req); const nonce = cookie(req, 'tf_nonce'); if (!nonce || typeof data.credential !== 'string' || data.credential.length > 12000) throw new HttpError(400, '请重新打开登录窗口。');
  const u = await verifyGoogle(data.credential, client, nonce); const token = crypto.randomUUID() + crypto.randomUUID();
  await db().batch([
    db().prepare('INSERT INTO users (id,name,email) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email').bind(u.id,u.name,u.email),
    db().prepare('INSERT INTO sessions (hash,user_id,expires) VALUES (?,?,?)').bind(await digest(token),u.id,Date.now()+7*86400000),
    db().prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()),
  ]);
  const res = json({ user: u }); res.headers.append('Set-Cookie',sessionCookie(req, token, 604800)); res.headers.append('Set-Cookie','tf_nonce=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0'); return res;
}); }
