import { env } from 'cloudflare:workers';
export type Runtime = { DB: D1Database; ART_IMAGES?: R2Bucket; GOOGLE_CLIENT_ID?: string; OPENAI_API_KEY?: string; OPENAI_MODEL?: string; DAILY_JOB_LIMIT?: string; GLOBAL_DAILY_JOB_LIMIT?: string };
export const runtime = () => env as unknown as Runtime;
export const db = () => runtime().DB;
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export async function handler(fn: () => Promise<Response>) { try { return await fn(); } catch (e) { if (e instanceof HttpError) return json({ error: e.message }, e.status); console.error('Application request failed', e instanceof Error ? e.name : 'unknown'); if (process.env.NODE_ENV !== 'production' && e instanceof Error) console.error(e.message); return json({ error: '服务暂时不可用，请稍后重试。' }, 500); } }
export function sameOrigin(req: Request) { if (req.headers.get('origin') !== new URL(req.url).origin) throw new HttpError(403, '请从应用页面提交操作。'); }
export async function body(req: Request) { const t = await req.text(); if (t.length > 16000) throw new HttpError(413, '输入过长。'); try { return JSON.parse(t); } catch { throw new HttpError(400, '请求内容无效。'); } }
export async function digest(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join(''); }
export function cookie(req: Request, key: string) { return (req.headers.get('cookie') ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(key + '='))?.slice(key.length + 1); }
export async function user(req: Request) {
  const token = cookie(req, 'tf_session'); if (!token) return null;
  return db().prepare('SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ? AND sessions.expires > ?').bind(await digest(token), Date.now()).first<{ id: string; name: string; email: string }>();
}
export async function requireUser(req: Request) { const u = await user(req); if (!u) throw new HttpError(401, '请先使用 Google 账号登录。'); return u; }
export function sessionCookie(req: Request, value: string, age: number) { return `tf_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`; }

