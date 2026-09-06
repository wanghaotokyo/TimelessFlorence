import { handler, json, runtime, user } from '@/lib/server';
export async function GET(req: Request) { return handler(async () => { const e = runtime(); return json({ googleClientId: e.GOOGLE_CLIENT_ID ?? '', generationReady: Boolean(e.OPENAI_API_KEY && e.OPENAI_MODEL), user: await user(req) }); }); }
