import { handler, json, sameOrigin } from '@/lib/server';
export async function POST(req: Request) { return handler(async () => { sameOrigin(req); const nonce = crypto.randomUUID(); const res = json({ nonce }); res.headers.set('Set-Cookie', `tf_nonce=${nonce}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=300${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`); return res; }); }
