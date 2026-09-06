export type Language = 'zh' | 'ja' | 'en';
export type Duration = 2 | 5 | 15;
export type Source = { title: string; url: string };
export type Candidate = { title: string; originalTitle: string; creator: string; year: string; type: string; country: string; summary: string; sourceUrl: string };
export type Guide = { id: string; title: string; originalTitle: string; creator: string; year: string; country: string; type: string; language: Language; duration: Duration; sections: { title: string; text: string }[]; speech: string; sources: Source[]; artworkId?: string; imageFile?: string; imageQuery?: string; image: string | null; imageCredit: string | null; imageSource: string | null; imageDownloadable: boolean; createdAt: string; version: number; demo?: boolean };
export type User = { id: string; name: string; email: string };
export type Prefs = { duration?: number; engine?: string };
export type Config = { googleClientId: string; generationReady: boolean; user: User | null; prefs: Prefs };
export type Job = { id: string; kind: 'resolve' | 'generate'; state: string; error?: string; result?: { candidates: Candidate[]; message: string } | Guide };
export function splitSentences(text: string): string[] {
  return (text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? []).map(s => s.trim()).filter(Boolean).flatMap(s => {
    if (s.length <= 160) return [s];
    return s.match(/.{1,120}(?:[，,；;：:]|$)|.{1,120}/gu) ?? [s];
  });
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function validateTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('标题请输入 1–100 个字符。');
  return value.trim();
}
