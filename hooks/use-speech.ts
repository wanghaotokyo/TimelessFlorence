'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SentenceSpeaker, type SpeechState } from '@/lib/speech';
import { splitSentences } from '@/lib/types';
export function useSpeech(text:string,identity:string){
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);const [voiceURI,setVoiceURI]=useState('');const [supported,setSupported]=useState(true);
  const [state,setState]=useState<SpeechState>({status:'idle',index:0,error:''});const ref=useRef<SentenceSpeaker|null>(null);
  const sentences=useMemo(()=>splitSentences(text),[text]);
  useEffect(()=>{if(!('speechSynthesis'in window)){setSupported(false);return;}const load=()=>setVoices(window.speechSynthesis.getVoices().filter(v=>/^zh([_-]|$)/i.test(v.lang)&&v.localService));load();window.speechSynthesis.addEventListener('voiceschanged',load);return()=>window.speechSynthesis.removeEventListener('voiceschanged',load);},[]);
  const voice=voices.find(v=>v.voiceURI===voiceURI)||voices.find(v=>/^zh[-_]CN$/i.test(v.lang))||voices[0]||null;
  useEffect(()=>{if(!('speechSynthesis'in window))return;const speaker=new SentenceSpeaker(window.speechSynthesis,()=>new SpeechSynthesisUtterance(),s=>{setState({...s});if(['speaking','paused'].includes(s.status))localStorage.setItem('tf-bookmark:'+identity,String(s.index));},sentences,voice);ref.current=speaker;setState({...speaker.state});return()=>{speaker.destroy();ref.current=null;};},[sentences,voice,identity]);
  return {voices,voice,setVoiceURI,supported,state,sentences,start:()=>ref.current?.start(),resume:()=>ref.current?.resume(),pause:()=>ref.current?.pause(),stop:()=>ref.current?.stop(),move:(d:-1|1)=>ref.current?.move(d),continueLast:()=>ref.current?.start(Number(localStorage.getItem('tf-bookmark:'+identity))||0)};
}
