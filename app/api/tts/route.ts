import { handler, HttpError, sameOrigin } from '@/lib/server';
import { synthesize } from '@/lib/edge-tts';

export async function POST(req: Request) {
  return handler(async () => {
    sameOrigin(req);
    const raw = await req.text();
    if (raw.length > 16000) throw new HttpError(413, '请求过大。');
    let body: { text?: unknown; voice?: unknown };
    try { body = JSON.parse(raw); } catch { throw new HttpError(400, '请求内容无效。'); }
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new HttpError(400, '文字内容无效或过长。');
    const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined;
    const audio = await synthesize(body.text.trim(), voice);
    return new Response(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  });
}
