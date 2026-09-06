'use client';

import {
  ExternalLink,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Square,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArtImage } from './art-image';
import type { Guide } from '@/lib/types';
import type { LocalGuide } from '@/lib/local';
import type { useSpeech } from '@/hooks/use-speech';

export type Speech = ReturnType<typeof useSpeech>;

/** Inline guide display — shown directly below the search panel */
export function InlineGuide({
  guide,
  row,
  speech,
  onClose,
  onSettings,
  onRetryImage,
  imageBusy,
}: {
  guide: Guide;
  row?: LocalGuide;
  speech: Speech;
  onClose: () => void;
  onSettings: () => void;
  onRetryImage: () => void;
  imageBusy: boolean;
}) {
  const playbackPreparing = ['preparing', 'generating'].includes(
    speech.state.status,
  );
  const edgePreparation = speech.engine === 'edge' ? speech.preparation : null;
  const audioPreparing = edgePreparation?.status === 'preparing';
  const audioError = edgePreparation?.status === 'error';
  const action = audioError
    ? '重试生成音频'
    : speech.state.status === 'speaking'
      ? '暂停'
      : speech.state.status === 'paused'
        ? '继续讲解'
        : '开始讲解';
  const onPrimaryAction = () => {
    if (audioError) speech.retryPreparation();
    else if (speech.state.status === 'speaking') speech.pause();
    else if (speech.state.status === 'idle' || speech.state.status === 'ended') speech.start();
    else speech.resume();
  };

  return (
    <div className="inline-guide">
      {/* ── Compact title bar ── */}
      <div className="inline-guide-header">
        <div>
          <span className="eyebrow gold">
            {guide.type} · {guide.country} · {guide.year}
          </span>
          <h2 className="inline-guide-title">{guide.title}</h2>
          {guide.originalTitle && (
            <p className="original">{guide.originalTitle}</p>
          )}
          <div className="guide-meta-inline">
            <span>{guide.creator}</span>
            <span>
              {{ zh: '中文', ja: '日本語', en: 'English' }[guide.language]} · 约{' '}
              {guide.duration} 分钟
            </span>
            {guide.demo && <span>编辑示例</span>}
          </div>
        </div>
        <div className="inline-guide-actions">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭作品">
            <X size={18} />
          </Button>
        </div>
      </div>

      {/* ── Image preview ── */}
      <ArtImage guide={guide} row={row} className="inline-guide-image" />
      <div className="image-credit" aria-live="polite">
        <span>{imageBusy ? '正在获取并保存图片…' : row?.offline ? row.imageBlob ? '文字与图片已离线保存' : '文字已保存，图片待重试' : '图片可单独重新获取'}</span>
        {row?.imageError && <p>{row.imageError}</p>}
        <Button variant="ghost" disabled={imageBusy} onClick={onRetryImage}>
          {imageBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          {row?.imageBlob ? '重新获取图片' : '重试图片'}
        </Button>
      </div>
      {(guide.imageCredit || guide.imageSource) && (
        <p className="image-credit">
          {guide.imageCredit}
          {guide.imageSource && (
            <a href={guide.imageSource} target="_blank" rel="noreferrer">
              {' '}
              图片来源 <ExternalLink size={12} />
            </a>
          )}
        </p>
      )}

      {/* ── Play controls ── */}
      {guide.language === 'zh' && (
        <div className="inline-play-card">
          <div className="inline-play-controls">
            <Button
              onClick={onPrimaryAction}
              disabled={
                audioPreparing ||
                playbackPreparing ||
                (!speech.canPlay && !audioError)
              }
            >
              {(audioPreparing || playbackPreparing) && (
                <LoaderCircle className="spin" />
              )}
              {audioError && <RefreshCw />}
              {audioPreparing
                ? `生成音频 ${edgePreparation!.completed}/${edgePreparation!.total}`
                : action}
            </Button>
          </div>
          {edgePreparation?.status === 'ready' && (
            <p className="play-ready-note">音频已就绪 · {edgePreparation.total} 句</p>
          )}
          {audioError && (
            <p className="play-error-note">{edgePreparation?.error}</p>
          )}
        </div>
      )}

      {/* ── Reading content ── */}
      <article
        className="guide-reading"
        lang={guide.language === 'zh' ? 'zh-CN' : guide.language}
      >
        {guide.sections.map((section, index) => (
          <section className="prose-section" key={index}>
            <h3>{section.title}</h3>
            <p>{section.text}</p>
          </section>
        ))}
      </article>

      {/* ── Speech transcript (zh only) ── */}
      {guide.language === 'zh' && speech.sentences.length > 0 && (
        <div className="transcript">
          <p className="transcript-label">口播文本</p>
          {speech.sentences.map((sentence, index) => (
            <p
              key={index}
              className={
                speech.state.index === index && speech.state.status !== 'idle'
                  ? 'current-sentence'
                  : ''
              }
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {sentence}
            </p>
          ))}
        </div>
      )}

      {/* ── Sources ── */}
      {guide.sources.length > 0 && (
        <div className="sources">
          <p className="sources-label">参考来源</p>
          {guide.sources.map((source, index) => (
            <a key={index} href={source.url} target="_blank" rel="noreferrer">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                {source.title}
                <small>{new URL(source.url).hostname}</small>
              </div>
              <ExternalLink size={16} />
            </a>
          ))}
          <p className="quiet">史实与解读可能随研究更新。来源链接需要联网打开。</p>
        </div>
      )}
    </div>
  );
}

export function Player({ guide, speech }: { guide: Guide; speech: Speech }) {
  const playbackPreparing = ['preparing', 'generating'].includes(
    speech.state.status,
  );
  const edgePreparing =
    speech.engine === 'edge' && speech.preparation.status === 'preparing';
  const edgeError =
    speech.engine === 'edge' && speech.preparation.status === 'error';
  const active = ['speaking', 'paused'].includes(speech.state.status);
  const label = edgePreparing
    ? `正在准备音频 ${speech.preparation.completed}/${speech.preparation.total}`
    : edgeError
      ? '音频生成中断'
      : speech.state.status === 'generating'
        ? '正在生成当前句'
        : speech.state.status === 'ended'
          ? '讲解结束'
          : '';
  const edgeIdle = speech.engine === 'edge' && speech.preparation.status === 'idle';
  const caption = edgePreparing
    ? `后台逐句生成并保存，已完成 ${speech.preparation.completed} / ${speech.preparation.total} 句`
    : edgeError
      ? speech.preparation.error
      : speech.state.error ||
        (!speech.canPlay
          ? edgeIdle
            ? '正在准备音频…'
            : '当前浏览器无法使用所选声音'
          : speech.state.status === 'idle'
            ? (speech.sentences[0] ?? '')
            : speech.sentences[speech.state.index]);
  const onPlay = () => {
    if (edgeError) speech.retryPreparation();
    else if (speech.state.status === 'speaking') speech.pause();
    else if (speech.state.status === 'idle' || speech.state.status === 'ended') speech.start();
    else speech.resume();
  };
  return (
    <div className="player" aria-label="中文讲解控制">
      <div className="player-title">
        <Headphones />
        <div>
          <strong>{guide.title}</strong>
          <span>
            {label ? `${label} · ` : ''}第 {speech.state.index + 1} / {speech.sentences.length} 句
          </span>
        </div>
      </div>
      <div className="player-controls">
        <Button
          variant="ghost"
          size="icon"
          aria-label="上一句"
          title="上一句"
          disabled={!active || speech.state.index === 0}
          onClick={() => speech.move(-1)}
        >
          <SkipBack />
        </Button>
        <Button
          className="play-button"
          size="icon"
          aria-label={edgeError ? '重试生成' : '播放或暂停'}
          disabled={playbackPreparing || (!speech.canPlay && !edgeError)}
          onClick={onPlay}
        >
          {edgePreparing || playbackPreparing ? (
            <LoaderCircle className="spin" />
          ) : edgeError ? (
            <RefreshCw />
          ) : speech.state.status === 'speaking' ? (
            <Pause />
          ) : (
            <Play />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="下一句"
          title="下一句"
          disabled={
            !active || speech.state.index === speech.sentences.length - 1
          }
          onClick={() => speech.move(1)}
        >
          <SkipForward />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="停止"
          title="停止"
          onClick={speech.stop}
        >
          <Square size={17} />
        </Button>
      </div>
      <output className="player-caption">{caption}</output>
    </div>
  );
}

export { InlineGuide as GuideDetail };
