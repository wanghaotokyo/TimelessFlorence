'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SentenceSpeaker, type SpeechState } from '@/lib/speech';
import { splitSentences } from '@/lib/types';

export type SpeechEngine = 'natural' | 'system';
type ModelStatus = 'idle' | 'preparing' | 'ready' | 'error';
type ModelState = { status: ModelStatus; progress: number; error: string; cached: boolean };
type NaturalModel = {
  generate(text: string, options: { voice: 'zf_001'; speed: number }): Promise<{ data: Float32Array; toBlob(): Blob }>;
};
type ProgressInfo = { status?: string; progress?: number; loaded?: number; total?: number; file?: string };

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX';
const MODEL_CACHE_HINT = 'tf-kokoro-zh-ready-v2';
const ENGINE_KEY = 'tf-speech-engine';

function emptyState(): SpeechState {
  return { status: 'idle', index: 0, error: '' };
}

export function useSpeech(text: string, identity: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [supported, setSupported] = useState(true);
  const [systemState, setSystemState] = useState<SpeechState>(emptyState);
  const [naturalState, setNaturalState] = useState<SpeechState>(emptyState);
  const [engine, setEngineState] = useState<SpeechEngine>('natural');
  const [naturalSupported, setNaturalSupported] = useState(false);
  const [modelState, setModelState] = useState<ModelState>({ status: 'idle', progress: 0, error: '', cached: false });

  const systemRef = useRef<SentenceSpeaker | null>(null);
  const modelRef = useRef<NaturalModel | null>(null);
  const modelPromiseRef = useRef<Promise<NaturalModel> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef('');
  const naturalEpochRef = useRef(0);
  const sentences = useMemo(() => splitSentences(text), [text]);

  useEffect(() => {
    const canUseSystem = 'speechSynthesis' in window;
    setSupported(canUseSystem);
    setNaturalSupported(typeof WebAssembly !== 'undefined');
    setModelState(state => ({ ...state, cached: localStorage.getItem(MODEL_CACHE_HINT) === '1' }));
    const saved = localStorage.getItem(ENGINE_KEY);
    if (saved === 'natural' || saved === 'system') setEngineState(saved);
    if (!canUseSystem) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter(voice => /^zh([_-]|$)/i.test(voice.lang) && voice.localService));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const voice = voices.find(item => item.voiceURI === voiceURI)
    ?? voices.find(item => /^zh[-_]CN$/i.test(item.lang))
    ?? voices[0]
    ?? null;

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speaker = new SentenceSpeaker(
      window.speechSynthesis,
      () => new SpeechSynthesisUtterance(),
      next => {
        setSystemState({ ...next });
        if (['speaking', 'paused'].includes(next.status)) localStorage.setItem(`tf-bookmark:${identity}`, String(next.index));
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

  const clearNaturalAudio = useCallback(() => {
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

  const stopNatural = useCallback((reset = true) => {
    naturalEpochRef.current += 1;
    clearNaturalAudio();
    if (reset) setNaturalState(emptyState());
  }, [clearNaturalAudio]);

  useEffect(() => {
    stopNatural();
    return () => stopNatural(false);
  }, [identity, text, stopNatural]);

  const prepareNatural = useCallback(async (): Promise<NaturalModel> => {
    if (modelRef.current) return modelRef.current;
    if (modelPromiseRef.current) return modelPromiseRef.current;
    if (typeof WebAssembly === 'undefined') {
      const message = '当前浏览器不支持本地自然声，请改用最新版 Edge 或 Chrome。';
      setModelState(state => ({ ...state, status: 'error', error: message }));
      throw new Error(message);
    }

    setModelState(state => ({ ...state, status: 'preparing', progress: 0, error: '' }));
    const promise = import('@uzen/kokoro-js').then(async ({ KokoroTTS }) => {
      const model = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        device: 'wasm',
        voicePath: '/kokoro/voices',
        progress_callback: (raw: unknown) => {
          const info = raw as ProgressInfo;
          if (info.status !== 'progress') return;
          const calculated = typeof info.progress === 'number'
            ? info.progress
            : info.total && typeof info.loaded === 'number'
              ? (info.loaded / info.total) * 100
              : 0;
          if (info.file?.endsWith('.onnx') || calculated > 0) {
            setModelState(state => ({ ...state, status: 'preparing', progress: Math.max(0, Math.min(100, Math.round(calculated))) }));
          }
        },
      });
      modelRef.current = model as NaturalModel;
      localStorage.setItem(MODEL_CACHE_HINT, '1');
      setModelState({ status: 'ready', progress: 100, error: '', cached: true });
      try { await navigator.storage?.persist?.(); } catch { /* Cache remains usable without persistent-storage permission. */ }
      return model as NaturalModel;
    }).catch(error => {
      modelPromiseRef.current = null;
      const message = navigator.onLine
        ? '自然声准备失败。请刷新页面后重试，或暂时选择 Windows 系统声音。'
        : '自然声模型尚未完整下载，请联网完成一次准备。';
      setModelState(state => ({ ...state, status: 'error', error: message }));
      throw error instanceof Error ? new Error(message, { cause: error }) : new Error(message);
    });
    modelPromiseRef.current = promise;
    return promise;
  }, []);

  const playNatural = useCallback(async (requestedIndex: number) => {
    if (!sentences.length) return;
    const index = Math.max(0, Math.min(requestedIndex, sentences.length - 1));
    const epoch = naturalEpochRef.current + 1;
    naturalEpochRef.current = epoch;
    clearNaturalAudio();
    setNaturalState({ status: modelRef.current ? 'generating' : 'preparing', index, error: '' });
    localStorage.setItem(`tf-bookmark:${identity}`, String(index));

    try {
      const model = await prepareNatural();
      if (epoch !== naturalEpochRef.current) return;
      setNaturalState({ status: 'generating', index, error: '' });
      const rawAudio = await model.generate(sentences[index], { voice: 'zf_001', speed: 0.94 });
      if (epoch !== naturalEpochRef.current) return;
      let peak = 0;
      let validSamples = 0;
      for (let sampleIndex = 0; sampleIndex < rawAudio.data.length; sampleIndex += 1) {
        const sample = rawAudio.data[sampleIndex];
        if (!Number.isFinite(sample)) {
          rawAudio.data[sampleIndex] = 0;
          continue;
        }
        validSamples += 1;
        peak = Math.max(peak, Math.abs(sample));
      }
      if (!validSamples || peak < 0.00001) throw new Error('生成的语音没有可播放的声音。');
      const gain = Math.min(12, 0.75 / peak);
      if (gain !== 1) for (let sampleIndex = 0; sampleIndex < rawAudio.data.length; sampleIndex += 1) rawAudio.data[sampleIndex] *= gain;
      const url = URL.createObjectURL(rawAudio.toBlob());
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.autoplay = false;
      audio.muted = false;
      audio.volume = 1;
      audio.setAttribute('playsinline', '');
      audio.dataset.tfNaturalAudio = 'true';
      audio.dataset.tfNaturalPeak = peak.toFixed(4);
      audio.dataset.tfNaturalGain = gain.toFixed(2);
      audio.style.display = 'none';
      document.body.appendChild(audio);
      audio.src = url;
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = () => {
        if (epoch !== naturalEpochRef.current) return;
        if (index >= sentences.length - 1) {
          clearNaturalAudio();
          setNaturalState({ status: 'ended', index, error: '' });
        } else {
          void playNatural(index + 1);
        }
      };
      audio.onerror = () => {
        if (epoch === naturalEpochRef.current) setNaturalState({ status: 'error', index, error: '自然声播放失败，可以从当前句重新开始。' });
      };
      try {
        await audio.play();
        if (epoch === naturalEpochRef.current) setNaturalState({ status: 'speaking', index, error: '' });
      } catch {
        if (epoch === naturalEpochRef.current) setNaturalState({ status: 'paused', index, error: '声音已准备好，请再次点击播放。' });
      }
    } catch {
      if (epoch === naturalEpochRef.current) setNaturalState({ status: 'error', index, error: '自然声生成失败。请刷新页面后重试，或在语音设置中选择 Windows 系统声音。' });
    }
  }, [clearNaturalAudio, identity, prepareNatural, sentences]);

  const resumeNatural = useCallback(() => {
    const audio = audioRef.current;
    if (naturalState.status === 'paused' && audio) {
      void audio.play()
        .then(() => setNaturalState(state => ({ ...state, status: 'speaking', error: '' })))
        .catch(() => setNaturalState(state => ({ ...state, error: '浏览器阻止了播放，请再次点击。' })));
      return;
    }
    void playNatural(naturalState.status === 'ended' ? 0 : naturalState.index);
  }, [naturalState.index, naturalState.status, playNatural]);

  const pauseNatural = useCallback(() => {
    const audio = audioRef.current;
    if (naturalState.status === 'speaking' && audio) {
      audio.pause();
      setNaturalState(state => ({ ...state, status: 'paused', error: '' }));
    }
  }, [naturalState.status]);

  const moveNatural = useCallback((delta: -1 | 1) => {
    const index = naturalState.index + delta;
    if (index < 0 || index >= sentences.length) return;
    void playNatural(index);
  }, [naturalState.index, playNatural, sentences.length]);

  const setEngine = useCallback((next: SpeechEngine) => {
    systemRef.current?.stop();
    stopNatural();
    localStorage.setItem(ENGINE_KEY, next);
    setEngineState(next);
  }, [stopNatural]);

  const state = engine === 'natural' ? naturalState : systemState;
  const canPlay = engine === 'natural' ? naturalSupported : Boolean(voice && supported);
  const isBusy = ['preparing', 'generating'].includes(state.status);

  return {
    engine,
    setEngine,
    voices,
    voice,
    setVoiceURI,
    supported,
    naturalSupported,
    modelState,
    prepareNatural,
    state,
    sentences,
    canPlay,
    isBusy,
    start: () => engine === 'natural' ? void playNatural(0) : systemRef.current?.start(),
    resume: () => engine === 'natural' ? resumeNatural() : systemRef.current?.resume(),
    pause: () => engine === 'natural' ? pauseNatural() : systemRef.current?.pause(),
    stop: () => engine === 'natural' ? stopNatural() : systemRef.current?.stop(),
    move: (delta: -1 | 1) => engine === 'natural' ? moveNatural(delta) : systemRef.current?.move(delta),
    continueLast: () => {
      const index = Number(localStorage.getItem(`tf-bookmark:${identity}`)) || 0;
      return engine === 'natural' ? void playNatural(index) : systemRef.current?.start(index);
    },
  };
}
