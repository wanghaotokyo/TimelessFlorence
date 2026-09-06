export const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';

const FALLBACK_EDGE_VOICES = ['zh-CN-YunxiNeural'] as const;

export function edgeVoiceCandidates(requested?: string): string[] {
  const preferred = requested?.trim() || DEFAULT_EDGE_VOICE;
  return [...new Set([preferred, DEFAULT_EDGE_VOICE, ...FALLBACK_EDGE_VOICES])];
}
