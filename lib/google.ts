import { HttpError } from './server';
type Key = JsonWebKey & { kid: string };
let cache: { keys: Key[]; expires: number } | undefined;
function decode(s: string) { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export async function verifyGoogle(token: string, audience: string, nonce: string) {
  try {
    const [h, p, signature, extra] = token.split('.'); if (!h || !p || !signature || extra) throw new Error();
    const head = JSON.parse(new TextDecoder().decode(decode(h)));
    const claims = JSON.parse(new TextDecoder().decode(decode(p)));
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error();
    if (!cache || cache.expires < Date.now() || !cache.keys.some(k => k.kid === head.kid)) {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      cache = { keys: (await response.json() as { keys: Key[] }).keys, expires: Date.now() + 3600000 };
    }
    const jwk = cache.keys.find(k => k.kid === head.kid); if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), new TextEncoder().encode(`${h}.${p}`));
    if (!ok || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== audience || claims.nonce !== nonce || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() || typeof claims.iat !== 'number' || claims.iat * 1000 > Date.now() + 60000 || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || !claims.email_verified) throw new Error();
    return { id: claims.sub, name: String(claims.name ?? claims.email ?? '艺术旅人').slice(0, 150), email: String(claims.email ?? '').slice(0, 255) };
  } catch { throw new HttpError(401, 'Google 登录验证失败，请重新登录。'); }
}
