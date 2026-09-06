export const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';
export const EDGE_TTS_RATE = '-5%';
export const EDGE_TTS_PITCH = '-2Hz';
export const EDGE_TTS_PROFILE = 'calm';

const FALLBACK_EDGE_VOICES = ['zh-CN-XiaoyiNeural'] as const;

export function edgeVoiceCandidates(requested?: string): string[] {
  const preferred = requested?.trim() || DEFAULT_EDGE_VOICE;
  return [...new Set([preferred, DEFAULT_EDGE_VOICE, ...FALLBACK_EDGE_VOICES])];
}
