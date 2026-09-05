'use client';

import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArtImage } from './art-image';
import type { Guide } from '@/lib/types';
import type { LocalGuide } from '@/lib/local';
import type { useSpeech } from '@/hooks/use-speech';

export type Speech = ReturnType<typeof useSpeech>;

function PreparationProgress({ speech }: { speech: Speech }) {
  if (speech.engine !== 'edge' || speech.preparation.status === 'idle')
    return null;
  const { completed, total, status, error } = speech.preparation;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return (
    <output className="audio-preparation" aria-live="polite">
      <span className="audio-preparation-heading">
        <strong>
          {status === 'ready'
            ? '讲解音频已准备完成'
            : status === 'error'
              ? '音频生成中断'
              : '正在后台生成讲解音频'}
        </strong>
        <span>{percent}%</span>
      </span>
      <Progress value={percent} aria-label="讲解音频生成进度" />
      <p>
        {status === 'ready'
          ? `共 ${total} 句，已保存到当前浏览器。`
          : error || `已完成 ${completed} / ${total} 句`}
      </p>
    </output>
  );
}

export function GuideDetail({
  guide,
  row,
  speech,
  busy,
  online,
  onBack,
  onDownload,
  onRemove,
  onSettings,
}: {
  guide: Guide;
  row?: LocalGuide;
  speech: Speech;
  busy: boolean;
  online: boolean;
  onBack: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onSettings: () => void;
}) {
  const playbackPreparing = ['preparing', 'generating'].includes(
    speech.state.status,
  );
  const edgePreparation = speech.engine === 'edge' ? speech.preparation : null;
  const description =
    speech.engine === 'edge'
      ? '讲解文出现后，自动用微软 Edge 在线自然声逐句生成，并保存到当前浏览器。'
      : speech.engine === 'qwen'
        ? '使用本地 Qwen3-TTS 高保真声音朗读。'
        : speech.voice
          ? '使用 Windows 中文系统声音即时朗读。'
          : '尚未找到 Windows 中文系统声音。';
  const action =
    edgePreparation?.status === 'preparing'
      ? `正在准备 ${edgePreparation.completed}/${edgePreparation.total}`
      : edgePreparation?.status === 'error'
        ? '重试生成音频'
        : speech.state.status === 'speaking'
          ? '暂停'
          : speech.state.status === 'paused'
            ? '继续讲解'
            : '开始讲解';
  const onPrimaryAction = () => {
    if (edgePreparation?.status === 'error') speech.retryPreparation();
    else if (speech.state.status === 'speaking') speech.pause();
    else speech.resume();
  };

  return (
    <div className="detail">
      <div className="detail-actions">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          返回
        </Button>
        {row?.offline ? (
          <Button variant="outline" onClick={onRemove}>
            <Check />
            已保存离线 · 移除
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={onDownload}
            disabled={busy || !online}
          >
            {busy ? <LoaderCircle className="spin" /> : <Download />}保存离线
          </Button>
        )}
      </div>
      <div className="detail-heading">
        <div>
          <span className="eyebrow gold">
            {guide.type} · {guide.country} · {guide.year}
          </span>
          <h1>{guide.title}</h1>
          <p className="original">{guide.originalTitle}</p>
        </div>
        <div className="guide-meta">
          <span>{guide.creator}</span>
          <span>
            {{ zh: '中文', ja: '日本語', en: 'English' }[guide.language]} · 约{' '}
            {guide.duration} 分钟
          </span>
          {guide.demo && <span>编辑示例 · 本机履历</span>}
        </div>
      </div>
      <ArtImage guide={guide} row={row} className="detail-image" />
      <p className="image-credit">
        {guide.imageCredit}
        {guide.imageSource && (
          <a href={guide.imageSource} target="_blank" rel="noreferrer">
            {' '}
            图片来源 <ExternalLink size={12} />
          </a>
        )}
      </p>
      <div className="reading-grid">
        <Tabs defaultValue="reading" className="reading">
          <TabsList variant="line">
            <TabsTrigger value="reading">
              <BookOpen />
              作品介绍
            </TabsTrigger>
            {guide.language === 'zh' && (
              <TabsTrigger value="speech">
                <Headphones />
                口播文本
              </TabsTrigger>
            )}
            <TabsTrigger value="sources">参考来源</TabsTrigger>
          </TabsList>
          <TabsContent value="reading">
            <article lang={guide.language === 'zh' ? 'zh-CN' : guide.language}>
              {guide.sections.map((section, index) => (
                <section className="prose-section" key={index}>
                  <h3>{section.title}</h3>
                  <p>{section.text}</p>
                </section>
              ))}
            </article>
          </TabsContent>
          {guide.language === 'zh' && (
            <TabsContent value="speech">
              <div className="transcript">
                {speech.sentences.map((sentence, index) => (
                  <p
                    key={index}
                    className={
                      speech.state.index === index &&
                      speech.state.status !== 'idle'
                        ? 'current-sentence'
                        : ''
                    }
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {sentence}
                  </p>
                ))}
              </div>
            </TabsContent>
          )}
          <TabsContent value="sources">
            <div className="sources">
              {guide.sources.map((source, index) => (
                <a
                  key={index}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    {source.title}
                    <small>{new URL(source.url).hostname}</small>
                  </div>
                  <ExternalLink size={16} />
                </a>
              ))}
              <p className="quiet">
                史实与解读可能随研究更新。来源链接需要联网打开。
              </p>
            </div>
          </TabsContent>
        </Tabs>
        <aside className="listen-card">
          <Headphones className="gold" size={25} />
          <h3>听一段作品的故事</h3>
          {guide.language === 'zh' ? (
            <>
              <p>{description}</p>
              <PreparationProgress speech={speech} />
              <Button
                onClick={onPrimaryAction}
                disabled={
                  playbackPreparing ||
                  (!speech.canPlay && edgePreparation?.status !== 'error')
                }
              >
                {edgePreparation?.status === 'preparing' ||
                playbackPreparing ? (
                  <LoaderCircle className="spin" />
                ) : edgePreparation?.status === 'error' ? (
                  <RefreshCw />
                ) : speech.state.status === 'speaking' ? (
                  <Pause />
                ) : (
                  <Play />
                )}
                {action}
              </Button>
              <button className="text-link" onClick={onSettings}>
                选择朗读声音 <ArrowUpRight size={14} />
              </button>
              <p className="small-note">
                {speech.engine === 'edge'
                  ? '免费 · 在线生成 · 音频保存在当前浏览器'
                  : speech.engine === 'qwen'
                    ? '免费 · 本机生成 · 当前会话使用'
                    : '免费 · Windows 系统声音'}
              </p>
            </>
          ) : (
            <p>本版只提供中文语音。你仍可阅读和离线保存这篇介绍。</p>
          )}
        </aside>
      </div>
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
        : speech.state.status === 'paused'
          ? '已暂停'
          : speech.state.status === 'speaking'
            ? '正在讲解'
            : speech.state.status === 'ended'
              ? '讲解结束'
              : speech.engine === 'edge'
                ? 'Edge 音频已准备'
                : speech.engine === 'qwen'
                  ? '本地 Qwen3-TTS'
                  : 'Windows 系统声音';
  const caption = edgePreparing
    ? `后台逐句生成并保存，已完成 ${speech.preparation.completed} / ${speech.preparation.total} 句`
    : edgeError
      ? speech.preparation.error
      : speech.state.error ||
        (!speech.canPlay
          ? '当前浏览器无法使用所选声音'
          : speech.state.status === 'idle'
            ? '音频准备完成后即可播放'
            : speech.sentences[speech.state.index]);
  const onPlay = () => {
    if (edgeError) speech.retryPreparation();
    else if (speech.state.status === 'speaking') speech.pause();
    else speech.resume();
  };
  return (
    <div className="player" aria-label="中文讲解控制">
      <div className="player-title">
        <Headphones />
        <div>
          <strong>{guide.title}</strong>
          <span>
            {label} · 第 {speech.state.index + 1} / {speech.sentences.length} 句
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
