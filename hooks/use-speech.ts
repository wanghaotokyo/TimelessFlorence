'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SentenceSpeaker, type SpeechState } from '@/lib/speech';
import { splitSentences } from '@/lib/types';
import { readAudioCache, writeAudioCache } from '@/lib/audio-cache';

export type SpeechEngine = 'edge' | 'qwen' | 'system';
type ModelStatus = 'idle' | 'preparing' | 'ready' | 'error';
type ModelState = {
  status: ModelStatus;
  progress: number;
  error: string;
  cached: boolean;
};
export type AudioPreparationState = {
  status: 'idle' | 'preparing' | 'ready' | 'error';
  completed: number;
  total: number;
  error: string;
};

const QWEN_URL_KEY = 'tf-qwen-tts-url';
const DEFAULT_QWEN_URL = 'http://127.0.0.1:9233';
const ENGINE_KEY = 'tf-speech-engine';
const EDGE_AUDIO_PROFILE = 'xiaomo-calm-1.15-rate-14-pitch-1-v1';

function emptyState(): SpeechState {
  return { status: 'idle', index: 0, error: '' };
}

export function useSpeech(text: string, identity: string) {
  /* ── System engine (Web Speech API) ── */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [supported, setSupported] = useState(true);
  const [systemState, setSystemState] = useState<SpeechState>(emptyState);
  const systemRef = useRef<SentenceSpeaker | null>(null);

  /* ── Audio engine state (shared by Edge + Qwen) ── */
  const [audioState, setAudioState] = useState<SpeechState>(emptyState);
  const audioEpochRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef('');
  const prefetchRef = useRef<Map<number, Blob>>(new Map());
  const [preparation, setPreparation] = useState<AudioPreparationState>({
    status: 'idle',
    completed: 0,
    total: 0,
    error: '',
  });
  const [preparationAttempt, setPreparationAttempt] = useState(0);

  /* ── Qwen3-TTS service state ── */
  const [qwenUrl, setQwenUrlState] = useState(DEFAULT_QWEN_URL);
  const [modelState, setModelState] = useState<ModelState>({
    status: 'idle',
    progress: 0,
    error: '',
    cached: true,
  });

  /* ── Engine selection ── */
  const [engine, setEngineState] = useState<SpeechEngine>('edge');

  const sentences = useMemo(() => splitSentences(text), [text]);

  /* ════════════════════════════════════════════════════
     Initialization
     ════════════════════════════════════════════════════ */
  useEffect(() => {
    const canUseSystem = 'speechSynthesis' in window;
    setSupported(canUseSystem);

    const savedEngine = localStorage.getItem(ENGINE_KEY);
    if (
      savedEngine === 'edge' ||
      savedEngine === 'qwen' ||
      savedEngine === 'system'
    ) {
      setEngineState(savedEngine);
    } else if (savedEngine === 'natural') {
      // Migrate retired local engines to Edge.
      setEngineState('edge');
      localStorage.setItem(ENGINE_KEY, 'edge');
    }

    const savedQwenUrl = localStorage.getItem(QWEN_URL_KEY);
    if (savedQwenUrl) setQwenUrlState(savedQwenUrl);

    if (!canUseSystem) return;
    const load = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .filter((v) => /^zh([_-]|$)/i.test(v.lang) && v.localService),
      );
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () =>
      window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const setQwenUrl = useCallback((url: string) => {
    const trimmed = url.trim().replace(/\/+$/, '') || DEFAULT_QWEN_URL;
    setQwenUrlState(trimmed);
    localStorage.setItem(QWEN_URL_KEY, trimmed);
  }, []);

  const voice =
    voices.find((v) => v.voiceURI === voiceURI) ??
    voices.find((v) => /^zh[-_]CN$/i.test(v.lang)) ??
    voices[0] ??
    null;

  /* ════════════════════════════════════════════════════
     System engine – SentenceSpeaker
     ════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speaker = new SentenceSpeaker(
      window.speechSynthesis,
      () => new SpeechSynthesisUtterance(),
      (next) => {
        setSystemState({ ...next });
        if (['speaking', 'paused'].includes(next.status))
          localStorage.setItem(`tf-bookmark:${identity}`, String(next.index));
      },
      sentences,
      voice,
    );
    systemRef.current = speaker;
    setSystemState({ ...speaker.state });
    return () => {
      speaker.destroy();
      systemRef.current = null;
    };
  }, [sentences, voice, identity]);

  /* ════════════════════════════════════════════════════
     Audio cleanup helpers (shared by Edge + Qwen)
     ════════════════════════════════════════════════════ */
  const clearAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = '';
  }, []);

  const stopAudio = useCallback(
    (reset = true) => {
      audioEpochRef.current += 1;
      clearAudio();
      if (reset) {
        setAudioState(emptyState());
        prefetchRef.current.clear();
      }
    },
    [clearAudio],
  );

  // Reset on identity / text change
  useEffect(() => {
    stopAudio();
    return () => stopAudio(false);
  }, [identity, text, stopAudio]);

  /* ════════════════════════════════════════════════════
     Audio blob generation — Edge TTS vs local Qwen3-TTS
     ════════════════════════════════════════════════════ */
  const generateEdgeBlob = useCallback(
    async (sentence: string, signal?: AbortSignal): Promise<Blob> => {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
        signal,
      });
      if (!resp.ok) throw new Error('Edge TTS 请求失败');
      return resp.blob();
    },
    [],
  );

  const edgeCacheKey = useCallback(
    (index: number) =>
      `edge:${EDGE_AUDIO_PROFILE}:${identity}:${index}:${sentences[index]}`,
    [identity, sentences],
  );

  /* ════════════════════════════════════════════════════
     Prepare and persist the complete Edge narration
     ════════════════════════════════════════════════════ */
  useEffect(() => {
    if (engine !== 'edge' || !sentences.length) {
      setPreparation({ status: 'idle', completed: 0, total: 0, error: '' });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const total = sentences.length;
    setPreparation({ status: 'preparing', completed: 0, total, error: '' });

    void (async () => {
      let completed = 0;
      try {
        for (let index = 0; index < total; index += 1) {
          if (cancelled) return;
          const key = edgeCacheKey(index);
          let blob = prefetchRef.current.get(index) ?? null;
          if (!blob) {
            try {
              blob = await readAudioCache(key);
            } catch {
              // Browser storage can be unavailable in private browsing.
            }
          }
          if (!blob) {
            blob = await generateEdgeBlob(sentences[index], controller.signal);
            try {
              await writeAudioCache(key, blob);
            } catch {
              // Keep the in-memory copy when persistent storage is unavailable.
            }
          }
          if (cancelled) return;
          prefetchRef.current.set(index, blob);
          completed = index + 1;
          setPreparation({
            status: completed === total ? 'ready' : 'preparing',
            completed,
            total,
            error: '',
          });
        }
      } catch (error) {
        if (cancelled || (error as Error).name === 'AbortError') return;
        setPreparation({
          status: 'error',
          completed,
          total,
          error: `第 ${completed + 1} 句生成失败，请检查网络后重试。`,
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [edgeCacheKey, engine, generateEdgeBlob, preparationAttempt, sentences]);

  const generateQwenBlob = useCallback(
    async (sentence: string): Promise<Blob> => {
      const base = qwenUrl || DEFAULT_QWEN_URL;
      const resp = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence, speaker: 'Serena' }),
        // The first Qwen request may download and load several gigabytes of weights.
        signal: AbortSignal.timeout(300000),
      });
      if (!resp.ok)
        throw new Error('本地 Qwen3-TTS 服务未就绪，请确认已启动服务。');
      return resp.blob();
    },
    [qwenUrl],
  );

  /* ════════════════════════════════════════════════════
     Check Qwen3-TTS connection
     ════════════════════════════════════════════════════ */
  const checkQwen = useCallback(async (): Promise<boolean> => {
    setModelState((s) => ({
      ...s,
      status: 'preparing',
      progress: 0,
      error: '',
    }));
    try {
      const blob = await generateQwenBlob('测试。');
      if (blob && blob.size > 0) {
        setModelState({
          status: 'ready',
          progress: 100,
          error: '',
          cached: true,
        });
        return true;
      }
      throw new Error('未返回有效音频');
    } catch (e) {
      const msg =
        (e as Error).message ||
        '本地 Qwen3-TTS 服务未就绪，请确保已启动本机服务。';
      setModelState({
        status: 'error',
        progress: 0,
        error: msg,
        cached: false,
      });
      return false;
    }
  }, [generateQwenBlob]);

  /* ════════════════════════════════════════════════════
     Prefetch pipeline
     ════════════════════════════════════════════════════ */
  const prefetchSentence = useCallback(
    (index: number, epoch: number, useEdge: boolean) => {
      if (index >= sentences.length || prefetchRef.current.has(index)) return;
      const gen = useEdge
        ? generateEdgeBlob(sentences[index])
        : generateQwenBlob(sentences[index]);
      gen
        .then((blob) => {
          if (epoch === audioEpochRef.current)
            prefetchRef.current.set(index, blob);
        })
        .catch(() => {
          /* prefetch failure is non-critical */
        });
    },
    [sentences, generateEdgeBlob, generateQwenBlob],
  );

  /* ════════════════════════════════════════════════════
     Core playback — sentence by sentence with prefetch
     ════════════════════════════════════════════════════ */
  const playAudio = useCallback(
    async (requestedIndex: number) => {
      if (!sentences.length) return;
      const index = Math.max(0, Math.min(requestedIndex, sentences.length - 1));
      const epoch = ++audioEpochRef.current;
      clearAudio();

      const useEdge = engine === 'edge';

      localStorage.setItem(`tf-bookmark:${identity}`, String(index));

      // 1. Try prefetch buffer
      let blob = prefetchRef.current.get(index);
      if (blob) {
        prefetchRef.current.delete(index);
      } else if (useEdge) {
        try {
          blob = (await readAudioCache(edgeCacheKey(index))) ?? undefined;
        } catch {
          // Fall through to on-demand generation.
        }
      }
      if (!blob) {
        // 2. Generate on demand
        setAudioState({
          status: 'generating',
          index,
          error: '',
        });

        try {
          blob = useEdge
            ? await generateEdgeBlob(sentences[index])
            : await generateQwenBlob(sentences[index]);
        } catch {
          // Fallback: if Edge is unavailable, try the local Qwen service.
          if (useEdge) {
            try {
              setAudioState({ status: 'generating', index, error: '' });
              blob = await generateQwenBlob(sentences[index]);
            } catch {
              if (epoch === audioEpochRef.current) {
                setAudioState({
                  status: 'error',
                  index,
                  error:
                    '在线语音服务不可用，且本地 Qwen3-TTS 未连接。请检查网络或启动 Qwen3-TTS 本机服务。',
                });
              }
              return;
            }
          } else {
            if (epoch === audioEpochRef.current) {
              setAudioState({
                status: 'error',
                index,
                error:
                  '本地 Qwen3-TTS 生成失败。请确认本机服务已在 ' +
                  (qwenUrl || DEFAULT_QWEN_URL) +
                  ' 启动。',
              });
            }
            return;
          }
        }
      }

      if (epoch !== audioEpochRef.current) return;

      // 3. Play the generated audio
      const url = URL.createObjectURL(blob);
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.autoplay = false;
      audio.muted = false;
      audio.volume = 1;
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      audio.src = url;
      audioRef.current = audio;
      audioUrlRef.current = url;

      audio.onended = () => {
        if (epoch !== audioEpochRef.current) return;
        if (index >= sentences.length - 1) {
          clearAudio();
          setAudioState({ status: 'ended', index, error: '' });
        } else {
          void playAudio(index + 1);
        }
      };
      audio.onerror = () => {
        if (epoch === audioEpochRef.current) {
          setAudioState({
            status: 'error',
            index,
            error: '语音播放失败，可以从当前句重新开始。',
          });
        }
      };

      // 4. Qwen remains on-demand and keeps a small in-memory lookahead buffer.
      if (engine === 'qwen') {
        for (let lookahead = 1; lookahead <= 2; lookahead += 1) {
          if (index + lookahead < sentences.length) {
            prefetchSentence(index + lookahead, epoch, false);
          }
        }
      }

      try {
        await audio.play();
        if (epoch === audioEpochRef.current) {
          setAudioState({ status: 'speaking', index, error: '' });
        }
      } catch {
        if (epoch === audioEpochRef.current) {
          setAudioState({
            status: 'paused',
            index,
            error: '声音已准备好，请再次点击播放。',
          });
        }
      }
    },
    [
      clearAudio,
      qwenUrl,
      engine,
      generateQwenBlob,
      generateEdgeBlob,
      edgeCacheKey,
      identity,
      prefetchSentence,
      sentences,
    ],
  );

  /* ════════════════════════════════════════════════════
     Pause / Resume / Move (audio engines)
     ════════════════════════════════════════════════════ */
  const pauseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audioState.status === 'speaking' && audio) {
      audio.pause();
      setAudioState((s) => ({ ...s, status: 'paused', error: '' }));
    }
  }, [audioState.status]);

  const resumeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audioState.status === 'paused' && audio) {
      void audio
        .play()
        .then(() =>
          setAudioState((s) => ({ ...s, status: 'speaking', error: '' })),
        )
        .catch(() =>
          setAudioState((s) => ({
            ...s,
            error: '浏览器阻止了播放，请再次点击。',
          })),
        );
      return;
    }
    void playAudio(audioState.status === 'ended' ? 0 : audioState.index);
  }, [audioState.index, audioState.status, playAudio]);

  const moveAudio = useCallback(
    (delta: -1 | 1) => {
      const index = audioState.index + delta;
      if (index < 0 || index >= sentences.length) return;
      void playAudio(index);
    },
    [audioState.index, playAudio, sentences.length],
  );

  /* ════════════════════════════════════════════════════
     Engine switching
     ════════════════════════════════════════════════════ */
  const setEngine = useCallback(
    (next: SpeechEngine) => {
      systemRef.current?.stop();
      stopAudio();
      localStorage.setItem(ENGINE_KEY, next);
      setEngineState(next);
    },
    [stopAudio],
  );

  /* ════════════════════════════════════════════════════
     Unified output — same API for all consumers
     ════════════════════════════════════════════════════ */
  const state = engine === 'system' ? systemState : audioState;
  const canPlay =
    engine === 'system'
      ? Boolean(voice && supported)
      : engine === 'edge'
        ? preparation.status === 'ready'
        : true;
  const isBusy = ['preparing', 'generating'].includes(state.status);

  return {
    engine,
    setEngine,
    voices,
    voice,
    setVoiceURI,
    supported,
    naturalSupported: true,
    modelState,
    preparation,
    retryPreparation: () => setPreparationAttempt((value) => value + 1),
    qwenUrl,
    setQwenUrl,
    checkQwen,
    state,
    sentences,
    canPlay,
    isBusy,
    start: () =>
      engine === 'system' ? systemRef.current?.start() : void playAudio(0),
    resume: () =>
      engine === 'system' ? systemRef.current?.resume() : resumeAudio(),
    pause: () =>
      engine === 'system' ? systemRef.current?.pause() : pauseAudio(),
    stop: () => (engine === 'system' ? systemRef.current?.stop() : stopAudio()),
    move: (delta: -1 | 1) =>
      engine === 'system' ? systemRef.current?.move(delta) : moveAudio(delta),
    continueLast: () => {
      const index =
        Number(localStorage.getItem(`tf-bookmark:${identity}`)) || 0;
      return engine === 'system'
        ? systemRef.current?.start(index)
        : void playAudio(index);
    },
  };
}
