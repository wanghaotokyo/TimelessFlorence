'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  History,
  Check,
  WifiOff,
  DoorOpen,
  Pencil,
  Trash2,
  LoaderCircle,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Picker } from './picker';
import { ArtImage } from './art-image';
import { InlineGuide, Player } from './guide-detail';
import { demoGuide } from '@/lib/demo';
import {
  type Guide,
  type Config,
  type Prefs,
  type Language,
  type Duration,
  type Candidate,
  type Job,
  validateTitle,
} from '@/lib/types';
import {
  listLocal,
  putLocal,
  removeLocal,
  clearOwner,
  downloadGuide,
  syncHistory,
  type LocalGuide,
} from '@/lib/local';
import { useSpeech, type SpeechEngine } from '@/hooks/use-speech';
import { RELEASE_VERSION } from '@/lib/release';
const languages = { zh: '中文', ja: '日本語', en: 'English' };
const date = (s: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(s));
const size = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`;
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  let data;
  try {
    data = (await r.json()) as any;
  } catch {
    throw new Error('连接失败，请稍后重试。');
  }
  if (!r.ok) throw new Error(data.error ?? '操作失败，请重试。');
  return data;
}
function post(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
function patch(data: unknown): RequestInit {
  return { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
export default function Florence() {
  const [guide, setGuide] = useState<Guide | null>(null),
    [query, setQuery] = useState(''),
    [language, setLanguage] = useState<Language>('zh'),
    [duration, setDuration] = useState<Duration>(5);
  const [config, setConfig] = useState<Config>({
      googleClientId: '',
      generationReady: false,
      user: null,
      prefs: {},
    }),
    [configLoaded, setConfigLoaded] = useState(false),
    [owner, setOwner] = useState('guest');
  const ownerRef = useRef(owner);
  const [rows, setRows] = useState<LocalGuide[]>([]),
    [online, setOnline] = useState(true),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(''),
    [settings, setSettings] = useState(false),
    [login, setLogin] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [rename, setRename] = useState<LocalGuide | null>(null),
    [newTitle, setNewTitle] = useState(''),
    [deleting, setDeleting] = useState<LocalGuide | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [resolveId, setResolveId] = useState(''),
    [selected, setSelected] = useState('0'),
    [job, setJob] = useState<{
      id: string;
      kind: 'resolve' | 'generate';
      state: string;
    } | null>(null),
    [candidateMessage, setCandidateMessage] = useState(''),
    [shellReady, setShellReady] = useState(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const googleRef = useRef<HTMLDivElement>(null);
  const speech = useSpeech(
    guide?.language === 'zh' ? guide.speech : '',
    `${owner}:${guide?.id ?? 'none'}`,
  );
  useEffect(() => {
    ownerRef.current = owner;
  }, [owner]);
  const refresh = useCallback(async () => {
    try {
      const current = ownerRef.current;
      const r = await listLocal(current);
      if (current === ownerRef.current) setRows(r);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);
  const sync = useCallback(async () => {
    const current = ownerRef.current;
    if (current === 'guest') return;
    try {
      const result = await syncHistory(current);
      if (ownerRef.current === current) setRows(result);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem('tf-owner');
    if (saved) setOwner(saved);
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    if ('serviceWorker' in navigator) {
      const localPreview =
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (localPreview)
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations.map((registration) => registration.unregister()),
            ),
          )
          .catch(() => {});
      else
        navigator.serviceWorker
          .register('/sw.js')
          .then(() => navigator.serviceWorker.ready)
          .then(() => setShellReady(true))
          .catch(() => setNotice('离线页面暂未准备好，请保持联网使用。'));
    }
    api('/api/config')
      .then(async (c: Config) => {
        const previous = localStorage.getItem('tf-owner');
        if (previous && previous !== c.user?.id) {
          await clearOwner(previous);
          localStorage.removeItem('tf-owner');
        }
        setConfig(c);
        setOwner(c.user?.id ?? 'guest');
        if (c.user) localStorage.setItem('tf-owner', c.user.id);
        // Apply saved prefs
        if (c.prefs?.duration && [2, 5, 15].includes(c.prefs.duration))
          setDuration(c.prefs.duration as Duration);
        if (c.prefs?.engine && ['edge', 'system'].includes(c.prefs.engine))
          speech.setEngine(c.prefs.engine as SpeechEngine);
        setConfigLoaded(true);
      })
      .catch(() => {
        setConfigLoaded(true);
        setNotice('当前无法连接账号服务，仍可打开本机已保存资料。');
      });
    return () => {
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
    };
  }, []);
  useEffect(() => {
    void refresh();
    if (owner !== 'guest' && online) void sync();
    const active = localStorage.getItem('tf-job:' + owner);
    if (active) {
      try {
        setJob(JSON.parse(active));
      } catch {
        localStorage.removeItem('tf-job:' + owner);
      }
    } else setJob(null);
  }, [owner, online, refresh, sync]);
  useEffect(() => {
    if (job) localStorage.setItem('tf-job:' + owner, JSON.stringify(job));
  }, [job, owner]);
  useEffect(() => {
    if (!job || !online || owner === 'guest') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next: Job = await api('/api/jobs/' + job.id);
        if (!alive) return;
        if (next.state === 'completed') {
          setJob(null);
          localStorage.removeItem('tf-job:' + owner);
          if (next.kind === 'resolve') {
            const result = next.result as {
              candidates: Candidate[];
              message: string;
            };
            setCandidates(result.candidates);
            setCandidateMessage(result.message);
            setResolveId(next.id);
            setSelected('0');
          } else {
            setGuide(next.result as Guide);
            setCandidates([]);
            await sync();
          }
          return;
        }
        if (['failed', 'cancelled'].includes(next.state)) {
          setNotice(next.error || '任务已取消。');
          setJob(null);
          localStorage.removeItem('tf-job:' + owner);
          return;
        }
        setJob((j) => (j ? { ...j, state: next.state } : j));
        timer = setTimeout(poll, 3500);
      } catch (e) {
        if (alive) {
          setNotice((e as Error).message);
          timer = setTimeout(poll, 10000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job?.id, online, owner, sync]);
  useEffect(() => {
    if (!login || !config.googleClientId) return;
    let stopped = false;
    const initialize = async () => {
      try {
        const { nonce } = await api('/api/auth/nonce', post({}));
        if (stopped) return;
        const google = (window as any).google;
        google.accounts.id.initialize({
          client_id: config.googleClientId,
          nonce,
          callback: async (response: { credential: string }) => {
            try {
              const result = await api('/api/auth/google', post(response));
              speech.stop();
              setGuide(null);
              setRows([]);
              setOwner(result.user.id);
              localStorage.setItem('tf-owner', result.user.id);
              setConfig((c) => ({ ...c, user: result.user }));
              setLogin(false);
              setNotice('已登录，履历将同步到你的账号。');
            } catch (e) {
              setNotice((e as Error).message);
            }
          },
        });
        if (googleRef.current)
          google.accounts.id.renderButton(googleRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            locale: 'zh_CN',
          });
      } catch (e) {
        setNotice((e as Error).message);
      }
    };
    if ((window as any).google) void initialize();
    else {
      let script = document.getElementById(
        'google-identity',
      ) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = 'google-identity';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        document.head.appendChild(script);
      }
      script.onload = () => void initialize();
      script.onerror = () => setNotice('无法连接 Google，请检查网络后重试。');
    }
    return () => {
      stopped = true;
    };
  }, [login, config.googleClientId]);
  async function openDemo() {
    speech.stop();
    const old = rows.find((r) => r.guide.id === demoGuide.id);
    const g = old?.guide ?? {
      ...demoGuide,
      createdAt: new Date().toISOString(),
    };
    setGuide(g);
    await putLocal(
      old ?? {
        key: `${owner}:${g.id}`,
        owner,
        guide: g,
        offline: false,
        bytes: 0,
      },
    ).catch((e) => setNotice(e.message));
    await refresh();
  }
  async function savePrefs(prefs: Prefs) {
    if (!config.user || !online) return;
    api('/api/config', patch(prefs)).catch(() => {});
  }
  async function search() {
    setNotice('');
    if (!query.trim()) return setNotice('请先输入作品名称、作者或一些线索。');
    if (!online) return setNotice('识别新作品需要联网，已有资料可以离线打开。');
    if (!config.user) {
      setLogin(true);
      return;
    }
    if (!config.generationReady)
      return setNotice('作品生成服务尚未配置，可先打开精选中文讲解体验。');
    // Clear previous result before new search
    speech.stop();
    setGuide(null);
    setCandidates([]);
    setCandidateMessage('');
    const id = crypto.randomUUID();
    setBusy('search');
    try {
      const result = await api(
        '/api/jobs',
        post({ id, kind: 'resolve', query }),
      );
      setJob({ id, kind: 'resolve', state: result.state });
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function generate() {
    const id = crypto.randomUUID();
    setBusy('generate');
    try {
      const result = await api(
        '/api/jobs',
        post({
          id,
          kind: 'generate',
          resolveId,
          candidateIndex: Number(selected),
          language,
          duration,
        }),
      );
      setJob({ id, kind: 'generate', state: result.state });
      setCandidates([]);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function cancel() {
    if (!job) return;
    try {
      await api('/api/jobs/' + job.id, { method: 'DELETE' });
      localStorage.removeItem('tf-job:' + owner);
      setJob(null);
      setNotice('已取消；已发出的文字服务请求可能仍计费。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const imageSaves = useRef(new Set<string>());
  const [imageBusyId,setImageBusyId] = useState('');
  async function saveOffline(g: Guide,repair=false) {
    const saveKey=owner+':'+g.id;
    if(imageSaves.current.has(saveKey))return;
    imageSaves.current.add(saveKey);
    setImageBusyId(g.id);
    try {
      const saved = await downloadGuide(
        owner,
        g,
        rows.find((r) => r.guide.id === g.id),
        repair,
      );
      if(ownerRef.current!==owner)return;
      setGuide(current=>current?.id===g.id?{...current,image:saved.guide.image,imageCredit:saved.guide.imageCredit,imageSource:saved.guide.imageSource,imageDownloadable:saved.guide.imageDownloadable,artworkId:saved.guide.artworkId,imageFile:saved.guide.imageFile}:current);
      if(saved.imageError)setNotice(saved.imageBlob ? '已保留原有离线图片。'+saved.imageError : '文字已保存，图片待重试。'+saved.imageError);
      else if(repair)setNotice('图片已更新并保存到本机。');
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      imageSaves.current.delete(saveKey);
      setImageBusyId(current=>current===g.id?'':current);
    }
  }
  async function unDownload(r: LocalGuide) {
    try {
      await putLocal({
        ...r,
        offline: false,
        imageBlob: undefined,
        imageHash: undefined,
        bytes: 0,
      });
      await refresh();
      setNotice('已移除本机下载，履历仍保留。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function doRename() {
    if (!rename) return;
    try {
      const title = validateTitle(newTitle);
      const next = {
        ...rename,
        guide: {
          ...rename.guide,
          title,
          version: rename.conflict?.version ?? rename.guide.version,
        },
        pending: rename.guide.demo ? undefined : ('rename' as const),
        conflict: undefined,
      };
      await putLocal(next);
      setRename(null);
      if (guide?.id === next.guide.id) setGuide(next.guide);
      await refresh();
      if (online && !next.guide.demo) await sync();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function doDelete() {
    if (!deleting) return;
    try {
      if (deleting.guide.demo) await removeLocal(deleting.key);
      else
        await putLocal({
          ...deleting,
          pending: 'delete',
          offline: false,
          imageBlob: undefined,
          bytes: 0,
        });
      if (guide?.id === deleting.guide.id) {
        speech.stop();
        setGuide(null);
      }
      setDeleting(null);
      await refresh();
      if (online) await sync();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function logout() {
    try {
      await api('/api/auth/logout', post({}));
      speech.stop();
      await clearOwner(owner);
      for (const key of Object.keys(localStorage))
        if (
          key.startsWith('tf-bookmark:' + owner + ':') ||
          key === 'tf-job:' + owner
        )
          localStorage.removeItem(key);
      localStorage.removeItem('tf-owner');
      setOwner('guest');
      setRows([]);
      setGuide(null);
      setConfig((c) => ({ ...c, user: null }));
      setSettings(false);
    } catch {
      setNotice('退出未完成，请联网重试，以结束账号会话。');
    }
  }
  const selectedRow = rows.find((r) => r.guide.id === guide?.id),
    visibleRows = rows
      .filter((r) => r.pending !== 'delete')
      .sort((a, b) => b.guide.createdAt.localeCompare(a.guide.createdAt));
  // Auto-save every guide to offline storage when it first loads
  useEffect(() => {
    if (!guide || !online) return;
    void saveOffline(guide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide?.id, online]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'stage_artwork_search',
          title: '填写作品线索',
          description:
            'Fill the visible artwork search form. Does not submit or spend credits.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            required: ['query'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const q = (input as any)?.query;
            if (typeof q !== 'string' || !q.trim() || q.length > 1000)
              throw new Error('请输入 1–1000 字线索。');
            window.speechSynthesis?.cancel();
            setGuide(null);
            setQuery(q);
            await new Promise((resolve) => setTimeout(resolve, 0));
            return { query: q, submitted: false };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-actions">
          {!online && (
            <span className="quiet topbar-status">
              <WifiOff size={14} /> 离线
            </span>
          )}
          <button
            className="user-avatar-btn"
            onClick={() => (config.user ? setSettings(true) : setLogin(true))}
            disabled={!configLoaded}
            aria-label={config.user ? config.user.name : 'Google 登录'}
            title={config.user ? config.user.name : 'Google 登录'}
          >
            {config.user ? (
              <span className="user-avatar">
                {config.user.name.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="user-avatar user-avatar--guest">
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </span>
            )}
          </button>
        </div>
        <a className="brand" href="/" aria-label="Timeless Florence 首页">
          Timeless <i>Florence</i>
          <span className="brand-version">{RELEASE_VERSION}</span>
        </a>
        <div style={{ display: 'flex', width: '120px', justifyContent: 'flex-end' }} />
      </header>
      <section className="main">
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {job && (
          <div className="job-panel" role="status">
            <LoaderCircle className="spin" />
            <div>
              <strong>
                {job.kind === 'resolve'
                  ? '正在寻找你描述的作品'
                  : '正在准备作品讲解'}
              </strong>
              <p>
                {job.state === 'research'
                  ? '查找资料与来源…'
                  : job.state === 'formatting'
                    ? '整理介绍文字…'
                    : '正在处理…'}{' '}
                可以稍后返回继续。
              </p>
            </div>
            <Button variant="outline" onClick={cancel}>取消</Button>
          </div>
        )}

        {/* ── Search panel ── */}
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="search-input-box">
            <input
              id="art-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={1000}
              placeholder="作品名称、作者，或你记得的细节…"
            />
          </div>
          <div className="search-actions">
            <Button type="submit" disabled={!!job || !!busy}>
              {busy === 'search' ? <LoaderCircle className="spin" /> : null}
              探索作品
            </Button>
          </div>
          <div className="search-secondary">
            <button
              type="button"
              className="text-link"
              onClick={() => { void refresh(); setHistoryOpen(true); }}
              disabled={visibleRows.length === 0}
            >
              履历
            </button>
            <button
              type="button"
              className="text-link"
              onClick={openDemo}
            >
              示例
            </button>
          </div>
        </form>

        {/* ── Candidate selection ── */}
        {!!candidates.length && (
          <div className="candidate-panel">
            <h2 style={{ textAlign: 'center' }}>你指的是哪一件作品？</h2>
            <p className="quiet" style={{ justifyContent: 'center' }}>
              确认后生成 {languages[language]} · 约 {duration}{' '}
              分钟的介绍。
            </p>
            <RadioGroup
              value={selected}
              onValueChange={(v) => setSelected(String(v))}
              aria-label="确认作品"
            >
              {candidates.map((c, i) => (
                <label key={i} className="candidate">
                  <RadioGroupItem value={String(i)} />
                  <div>
                    <strong>{c.title}</strong>
                    <p>
                      {c.creator} · {c.year} · {c.type}
                    </p>
                    <p>{c.summary}</p>
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      核对来源 <ExternalLink size={12} />
                    </a>
                  </div>
                </label>
              ))}
            </RadioGroup>
            <Button onClick={generate} disabled={!!busy || !!job} style={{ display: 'flex', margin: '20px auto 0' }}>
              确认作品，生成介绍
            </Button>
          </div>
        )}

        {/* ── Inline guide result ── */}
        {guide && (
          <InlineGuide
            guide={guide}
            row={selectedRow}
            onRetryImage={() => void saveOffline(guide,true)}
            imageBusy={imageBusyId===guide.id}
            speech={speech}
            onClose={() => {
              speech.stop();
              setGuide(null);
            }}
            onSettings={() => setSettings(true)}
          />
        )}

      </section>
      {guide?.language === 'zh' && <Player guide={guide} speech={speech} />}

      {/* ── Login dialog ── */}
      <Dialog open={login} onOpenChange={setLogin}>
        <DialogContent className="modal">
          <DialogTitle>把艺术旅程保存到你的账号</DialogTitle>
          <DialogDescription>
            使用 Google
            登录后，可以生成新讲解并同步履历。离线资料仍保存在当前设备。
          </DialogDescription>
          {config.googleClientId ? (
            <div ref={googleRef} className="google-button" />
          ) : (
            <div className="setup-note">
              Google
              登录尚未启用。管理员配置完成后即可登录；现在可以先体验精选讲解。
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setLogin(false);
              void openDemo();
            }}
          >
            先体验中文讲解
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Settings dialog ── */}
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="modal">
          <DialogTitle>设置</DialogTitle>
          <div className="setting-row">
            <span>讲解时长</span>
            <Picker
              label="讲解时长"
              value={String(duration)}
              onChange={(s) => { const d = Number(s) as Duration; setDuration(d); void savePrefs({ duration: d }); }}
              items={[2, 5, 15].map((n) => ({
                value: String(n),
                label: `${n} 分钟讲解`,
              }))}
            />
          </div>
          <div className="setting-row">
            <span>朗读引擎</span>
            <Picker
              label="选择朗读引擎"
              value={speech.engine}
              onChange={(value) => { speech.setEngine(value as SpeechEngine); void savePrefs({ engine: value }); }}
              items={[
                { value: 'edge', label: 'Edge 在线自然声' },
                { value: 'system', label: '本地声音（备用）' },
              ]}
            />
          </div>
          {speech.engine === 'system' && (
            <div className="setting-row">
              <span>系统声音</span>
              {speech.voices.length ? (
                <Picker
                  label="选择中文系统声音"
                  value={speech.voice?.voiceURI ?? ''}
                  onChange={speech.setVoiceURI}
                  items={speech.voices.map((v) => ({
                    value: v.voiceURI,
                    label: v.name,
                  }))}
                />
              ) : (
                <span className="setting-note">未找到可用声音</span>
              )}
            </div>
          )}
          <div className="setting-row">
            <span>离线资料</span>
            <span className="setting-note">
              {rows.filter((r) => r.offline).length} 篇 · {size(rows.reduce((n, r) => n + r.bytes, 0))}
            </span>
          </div>
          {!config.user && (
            <div className="setting-row">
              <span>账号</span>
              <Button variant="outline" size="sm" onClick={() => { setSettings(false); setLogin(true); }}>
                Google 登录
              </Button>
            </div>
          )}
          {config.user && (
            <div className="setting-footer">
              <button className="logout-btn" onClick={logout} aria-label="退出登录" title="退出登录">
                <DoorOpen size={18} />
                退出
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── History dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="modal modal-wide">
          <DialogTitle>讲解履历</DialogTitle>
          <DialogDescription>
            {owner === 'guest'
              ? '精选示例保存在本机。登录后，新生成讲解会同步到账号。'
              : '账号履历与本机示例。点击即可继续阅读。'}
          </DialogDescription>
          {config.user && (
            <Button variant="outline" size="sm" onClick={sync} style={{ alignSelf: 'flex-start' }}>
              <RefreshCw size={14} />
              同步
            </Button>
          )}
          {!visibleRows.length ? (
            <div className="empty-state">
              <History />
              <h2>艺术旅程，从一件作品开始</h2>
              <p>探索作品，或先打开精选中文讲解。</p>
            </div>
          ) : (
            <div className="history-list">
              {visibleRows.map((r) => (
                <article className="history-row" key={r.key}>
                  <button
                    className="history-open"
                    onClick={() => {
                      speech.stop();
                      setGuide(r.guide);
                      setHistoryOpen(false);
                    }}
                  >
                    <ArtImage guide={r.guide} row={r} />
                    <div>
                      <h3>{r.guide.title}</h3>
                      <p>
                        {r.guide.creator} · {languages[r.guide.language]} ·
                        约 {r.guide.duration} 分钟
                      </p>
                      <time>{date(r.guide.createdAt)}</time>
                      <div className="badges">
                        {r.guide.demo && <span>本机示例</span>}
                        {r.offline && (
                          <span>
                            <Check size={12} /> {r.imageBlob?'文字与图片已保存':'文字已保存 · 图片待重试'} · {size(r.bytes)}
                          </span>
                        )}
                        {r.pending && (
                          <span>
                            {r.conflict ? '标题同步冲突' : '等待同步'}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`修改 ${r.guide.title} 的标题`}
                      onClick={() => {
                        setRename(r);
                        setNewTitle(r.guide.title);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除 ${r.guide.title}`}
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Rename dialog ── */}
      <Dialog open={!!rename} onOpenChange={(open) => !open && setRename(null)}>
        <DialogContent className="modal">
          <DialogTitle>
            {rename?.conflict ? '处理标题冲突' : '修改履历标题'}
          </DialogTitle>
          <DialogDescription>
            {rename?.conflict
              ? `另一设备的标题是"${rename.conflict.title}"。你可以保存下方标题，或采用另一设备的标题。`
              : '只修改履历名称，不改变作品与介绍内容。'}
          </DialogDescription>
          <label htmlFor="rename-title">标题</label>
          <input
            className="text-input"
            id="rename-title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={100}
          />
          <DialogFooter>
            {rename?.conflict && (
              <Button
                variant="outline"
                onClick={async () => {
                  await putLocal({
                    ...rename,
                    pending: undefined,
                    conflict: undefined,
                    guide: {
                      ...rename.guide,
                      title: rename.conflict!.title,
                      version: rename.conflict!.version,
                    },
                  });
                  setRename(null);
                  await refresh();
                }}
              >
                采用云端标题
              </Button>
            )}
            <Button onClick={doRename}>保存标题</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>删除这篇讲解？</AlertDialogTitle>
          <AlertDialogDescription>
            "{deleting?.guide.title}"将从履历和当前设备中移除。
            {!online ? '联网后同步删除。' : ''}此操作无法撤销。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={doDelete}>
              删除讲解
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
