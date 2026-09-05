'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SentenceSpeaker, type SpeechState } from '@/lib/speech';
import { splitSentences } from '@/lib/types';

export type SpeechEngine = 'edge' | 'cosyvoice' | 'system';
type ModelStatus = 'idle' | 'preparing' | 'ready' | 'error';
type ModelState = { status: ModelStatus; progress: number; error: string; cached: boolean };

const COSYVOICE_URL_KEY = 'tf-cosyvoice-url';
const DEFAULT_COSYVOICE_URL = 'http://127.0.0.1:9233';
const ENGINE_KEY = 'tf-speech-engine';

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

  /* ── Audio engine state (shared by edge + cosyvoice) ── */
  const [audioState, setAudioState] = useState<SpeechState>(emptyState);
  const audioEpochRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef('');
  const prefetchRef = useRef<Map<number, Blob>>(new Map());

  /* ── CosyVoice service state ── */
  const [cosyVoiceUrl, setCosyVoiceUrlState] = useState(DEFAULT_COSYVOICE_URL);
  const [modelState, setModelState] = useState<ModelState>({ status: 'idle', progress: 0, error: '', cached: true });

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
    if (savedEngine === 'edge' || savedEngine === 'cosyvoice' || savedEngine === 'system') {
      setEngineState(savedEngine);
    } else if (savedEngine === 'natural') {
      // Migrate old Kokoro setting to edge (or cosyvoice)
      setEngineState('edge');
      localStorage.setItem(ENGINE_KEY, 'edge');
    }

    const savedCosyUrl = localStorage.getItem(COSYVOICE_URL_KEY);
    if (savedCosyUrl) setCosyVoiceUrlState(savedCosyUrl);

    if (!canUseSystem) return;
    const load = () => setVoices(
      window.speechSynthesis.getVoices().filter(v => /^zh([_-]|$)/i.test(v.lang) && v.localService),
    );
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const setCosyVoiceUrl = useCallback((url: string) => {
    const trimmed = url.trim().replace(/\/+$/, '') || DEFAULT_COSYVOICE_URL;
    setCosyVoiceUrlState(trimmed);
    localStorage.setItem(COSYVOICE_URL_KEY, trimmed);
  }, []);

  const voice = voices.find(v => v.voiceURI === voiceURI)
    ?? voices.find(v => /^zh[-_]CN$/i.test(v.lang))
    ?? voices[0]
    ?? null;

  /* ════════════════════════════════════════════════════
     System engine – SentenceSpeaker
     ════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speaker = new SentenceSpeaker(
      window.speechSynthesis,
      () => new SpeechSynthesisUtterance(),
      next => {
        setSystemState({ ...next });
        if (['speaking', 'paused'].includes(next.status))
          localStorage.setItem(`tf-bookmark:${identity}`, String(next.index));
      },
      sentences,
      voice,
    );
    systemRef.current = speaker;
    setSystemState({ ...speaker.state });
    return () => { speaker.destroy(); systemRef.current = null; };
  }, [sentences, voice, identity]);

  /* ════════════════════════════════════════════════════
     Audio cleanup helpers (shared by edge + cosyvoice)
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

  const stopAudio = useCallback((reset = true) => {
    audioEpochRef.current += 1;
    clearAudio();
    if (reset) {
      setAudioState(emptyState());
      prefetchRef.current.clear();
    }
  }, [clearAudio]);

  // Reset on identity / text change
  useEffect(() => {
    stopAudio();
    return () => stopAudio(false);
  }, [identity, text, stopAudio]);

  /* ════════════════════════════════════════════════════
     Audio blob generation — Edge TTS vs CosyVoice 2
     ════════════════════════════════════════════════════ */
  const generateEdgeBlob = useCallback(async (sentence: string): Promise<Blob> => {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence }),
    });
    if (!resp.ok) throw new Error('Edge TTS 请求失败');
    return resp.blob();
  }, []);

  const generateCosyVoiceBlob = useCallback(async (sentence: string): Promise<Blob> => {
    const base = cosyVoiceUrl || DEFAULT_COSYVOICE_URL;
    // Standard CosyVoice local endpoint format (supports /tts or /inference_cross_lingual or /api/tts)
    const endpoints = [
      `${base}/tts`,
      `${base}/inference_zero_shot`,
      `${base}/inference_cross_lingual`,
      `${base}/api/tts`,
    ];

    let lastError: Error | null = null;
    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sentence,
            tts_text: sentence,
            voice: '中文女',
            speaker: '中文女',
            speed: 1.0,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) return await resp.blob();
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(lastError?.message || '无法连接本地 CosyVoice 服务，请检查服务是否在 ' + base + ' 启动');
  }, [cosyVoiceUrl]);

  /* ════════════════════════════════════════════════════
     Check CosyVoice connection
     ════════════════════════════════════════════════════ */
  const checkCosyVoice = useCallback(async (): Promise<boolean> => {
    setModelState(s => ({ ...s, status: 'preparing', progress: 0, error: '' }));
    try {
      const blob = await generateCosyVoiceBlob('测试。');
      if (blob && blob.size > 0) {
        setModelState({ status: 'ready', progress: 100, error: '', cached: true });
        return true;
      }
      throw new Error('未返回有效音频');
    } catch (e) {
      const msg = (e as Error).message || '本地 CosyVoice 2 服务未就绪，请确保本地已启动服务。';
      setModelState({ status: 'error', progress: 0, error: msg, cached: false });
      return false;
    }
  }, [generateCosyVoiceBlob]);

  /* ════════════════════════════════════════════════════
     Prefetch pipeline
     ════════════════════════════════════════════════════ */
  const prefetchSentence = useCallback((index: number, epoch: number, useEdge: boolean) => {
    if (index >= sentences.length || prefetchRef.current.has(index)) return;
    const gen = useEdge ? generateEdgeBlob(sentences[index]) : generateCosyVoiceBlob(sentences[index]);
    gen.then(blob => {
      if (epoch === audioEpochRef.current) prefetchRef.current.set(index, blob);
    }).catch(() => { /* prefetch failure is non-critical */ });
  }, [sentences, generateEdgeBlob, generateCosyVoiceBlob]);

  /* ════════════════════════════════════════════════════
     Core playback — sentence by sentence with prefetch
     ════════════════════════════════════════════════════ */
  const playAudio = useCallback(async (requestedIndex: number) => {
    if (!sentences.length) return;
    const index = Math.max(0, Math.min(requestedIndex, sentences.length - 1));
    const epoch = ++audioEpochRef.current;
    clearAudio();

    const isOnline = navigator.onLine;
    // Rule: If online, prefer Edge Natural TTS. If offline (or explicitly selected cosyvoice when offline), use local CosyVoice.
    const useEdge = engine === 'edge' ? isOnline : (engine === 'cosyvoice' && isOnline ? true : false);

    localStorage.setItem(`tf-bookmark:${identity}`, String(index));

    // 1. Try prefetch buffer
    let blob = prefetchRef.current.get(index);
    if (blob) {
      prefetchRef.current.delete(index);
    } else {
      // 2. Generate on demand
      setAudioState({
        status: 'generating',
        index,
        error: '',
      });

      try {
        blob = useEdge
          ? await generateEdgeBlob(sentences[index])
          : await generateCosyVoiceBlob(sentences[index]);
      } catch {
        // Fallback: If edge failed (or offline), try CosyVoice
        if (useEdge) {
          try {
            setAudioState({ status: 'generating', index, error: '' });
            blob = await generateCosyVoiceBlob(sentences[index]);
          } catch {
            if (epoch === audioEpochRef.current) {
              setAudioState({
                status: 'error',
                index,
                error: '在线语音服务不可用，且本地 CosyVoice 2 未连接。请检查网络或确认本地 CosyVoice 已启动。',
              });
            }
            return;
          }
        } else {
          if (epoch === audioEpochRef.current) {
            setAudioState({
              status: 'error',
              index,
              error: '本地 CosyVoice 2 生成失败。请确认本地服务已在 ' + (cosyVoiceUrl || DEFAULT_COSYVOICE_URL) + ' 启动。',
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
        setAudioState({ status: 'error', index, error: '语音播放失败，可以从当前句重新开始。' });
      }
    };

    // 4. Prefetch next sentence while this one plays
    const nextUseEdge = engine === 'edge' ? navigator.onLine : false;
    if (index + 1 < sentences.length) {
      prefetchSentence(index + 1, epoch, nextUseEdge);
    }

    try {
      await audio.play();
      if (epoch === audioEpochRef.current) {
        setAudioState({ status: 'speaking', index, error: '' });
      }
    } catch {
      if (epoch === audioEpochRef.current) {
        setAudioState({ status: 'paused', index, error: '声音已准备好，请再次点击播放。' });
      }
    }
  }, [clearAudio, cosyVoiceUrl, engine, generateCosyVoiceBlob, generateEdgeBlob, identity, prefetchSentence, sentences]);

  /* ════════════════════════════════════════════════════
     Pause / Resume / Move (audio engines)
     ════════════════════════════════════════════════════ */
  const pauseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audioState.status === 'speaking' && audio) {
      audio.pause();
      setAudioState(s => ({ ...s, status: 'paused', error: '' }));
    }
  }, [audioState.status]);

  const resumeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audioState.status === 'paused' && audio) {
      void audio.play()
        .then(() => setAudioState(s => ({ ...s, status: 'speaking', error: '' })))
        .catch(() => setAudioState(s => ({ ...s, error: '浏览器阻止了播放，请再次点击。' })));
      return;
    }
    void playAudio(audioState.status === 'ended' ? 0 : audioState.index);
  }, [audioState.index, audioState.status, playAudio]);

  const moveAudio = useCallback((delta: -1 | 1) => {
    const index = audioState.index + delta;
    if (index < 0 || index >= sentences.length) return;
    void playAudio(index);
  }, [audioState.index, playAudio, sentences.length]);

  /* ════════════════════════════════════════════════════
     Engine switching
     ════════════════════════════════════════════════════ */
  const setEngine = useCallback((next: SpeechEngine) => {
    systemRef.current?.stop();
    stopAudio();
    localStorage.setItem(ENGINE_KEY, next);
    setEngineState(next);
  }, [stopAudio]);

  /* ════════════════════════════════════════════════════
     Unified output — same API for all consumers
     ════════════════════════════════════════════════════ */
  const state = engine === 'system' ? systemState : audioState;
  const canPlay = engine === 'system' ? Boolean(voice && supported) : true;
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
    cosyVoiceUrl,
    setCosyVoiceUrl,
    checkCosyVoice,
    state,
    sentences,
    canPlay,
    isBusy,
    start: () => engine === 'system' ? systemRef.current?.start() : void playAudio(0),
    resume: () => engine === 'system' ? systemRef.current?.resume() : resumeAudio(),
    pause: () => engine === 'system' ? systemRef.current?.pause() : pauseAudio(),
    stop: () => engine === 'system' ? systemRef.current?.stop() : stopAudio(),
    move: (delta: -1 | 1) => engine === 'system' ? systemRef.current?.move(delta) : moveAudio(delta),
    continueLast: () => {
      const index = Number(localStorage.getItem(`tf-bookmark:${identity}`)) || 0;
      return engine === 'system' ? systemRef.current?.start(index) : void playAudio(index);
    },
  };
}
