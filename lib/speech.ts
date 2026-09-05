export type SpeechState = { status: 'idle' | 'preparing' | 'generating' | 'speaking' | 'paused' | 'ended' | 'error'; index: number; error: string };
export interface Engine {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
}
// Sentence-level pause deliberately avoids unreliable browser native resume behavior.
export class SentenceSpeaker {
  state: SpeechState = { status: 'idle', index: 0, error: '' };
  private epoch = 0;
  private current: SpeechSynthesisUtterance | null = null;
  constructor(private engine: Engine, private create: () => SpeechSynthesisUtterance, private notify: (s: SpeechState) => void, private sentences: string[], private voice: SpeechSynthesisVoice | null) {}
  private publish(patch: Partial<SpeechState>) { this.state = { ...this.state, ...patch }; this.notify(this.state); }
  private invalidate() { this.epoch++; this.engine.cancel(); this.current = null; }
  start(index = this.state.index) {
    this.invalidate();
    if (!this.voice || !this.voice.localService) return this.publish({ status: 'error', error: '未找到本机中文声音，请在系统设置中安装中文语音后重试。' });
    if (!this.sentences.length) return;
    this.publish({ status: 'speaking', index: Math.max(0, Math.min(index, this.sentences.length - 1)), error: '' });
    this.read(this.epoch);
  }
  private read(epoch: number) {
    const u = this.create(); this.current = u;
    u.text = this.sentences[this.state.index]; u.voice = this.voice; u.lang = this.voice!.lang; u.rate = 0.95;
    u.onend = () => {
      if (epoch !== this.epoch || this.state.status !== 'speaking') return;
      if (this.state.index >= this.sentences.length - 1) { this.current = null; this.publish({ status: 'ended' }); }
      else { this.publish({ index: this.state.index + 1 }); this.read(epoch); }
    };
    u.onerror = event => { if (epoch === this.epoch) this.publish({ status: 'error', error: `朗读中断（${event.error}）。可以从当前句重新开始。` }); };
    this.engine.speak(u);
  }
  pause() { if (this.state.status === 'speaking') { this.invalidate(); this.publish({ status: 'paused' }); } }
  resume() { this.start(this.state.status === 'ended' ? 0 : this.state.index); }
  move(delta: -1 | 1) {
    if (!['speaking', 'paused'].includes(this.state.status)) return;
    const index = this.state.index + delta;
    if (index < 0 || index >= this.sentences.length) return;
    if (this.state.status === 'paused') { this.invalidate(); this.publish({ index }); } else this.start(index);
  }
  stop() { this.invalidate(); this.publish({ status: 'idle', index: 0, error: '' }); }
  destroy() { this.invalidate(); }
}
