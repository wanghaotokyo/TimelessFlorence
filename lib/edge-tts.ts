import { HttpError } from './server';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const DEFAULT_VOICE = 'zh-CN-XiaomoNeural';

const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cleanXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
}

function makeMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function makeSecMsGec(): Promise<string> {
  const winEpoch = 11644473600;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function synthesize(text: string, voice = DEFAULT_VOICE): Promise<ArrayBuffer> {
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const gec = await makeSecMsGec();
  const muid = makeMuid();

  // Cloudflare Workers' fetch-based WebSocket client must begin with an HTTP(S)
  // URL; the Upgrade header performs the WebSocket handshake. Passing a wss://
  // URL to fetch throws before the request reaches Edge's speech service.
  const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

  const resp = await fetch(url, {
    headers: {
      Upgrade: 'websocket',
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Cookie: `MUID=${muid}`,
    },
  }) as Response & { webSocket?: WebSocket };

  const ws = resp.webSocket;
  if (!ws) throw new HttpError(502, '无法连接语音服务。');
  ws.accept();
  ws.binaryType = 'arraybuffer';

  const config = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({
    context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: AUDIO_FORMAT } } },
  })}`;
  ws.send(config);

  const requestId = crypto.randomUUID().replace(/-/g, '');
  const ssml = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-CN'><voice name='${escapeXml(voice)}'><mstts:express-as style='calm' styledegree='1.15'><prosody rate='-14%' pitch='-1st'>${escapeXml(cleanXml(text))}</prosody></mstts:express-as></voice></speak>`;
  ws.send(ssml);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    let done = false;
    const chunks: ArrayBuffer[] = [];
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      reject(new HttpError(502, '语音生成超时。'));
    }, 15000);

    ws.addEventListener('message', (event: MessageEvent) => {
      if (done) return;
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          done = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          if (!chunks.length) { reject(new HttpError(502, '未收到语音数据。')); return; }
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const result = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { result.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
          resolve(result.buffer as ArrayBuffer);
        }
      } else {
        const data = event.data as ArrayBuffer;
        if (data.byteLength < 2) return;
        const headerLen = new DataView(data).getUint16(0);
        if (2 + headerLen >= data.byteLength) return;
        const audio = data.slice(2 + headerLen);
        if (audio.byteLength > 0) chunks.push(audio);
      }
    });

    ws.addEventListener('error', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new HttpError(502, '语音服务连接中断。'));
    });

    ws.addEventListener('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new HttpError(502, '语音服务连接意外关闭。'));
    });
  });
}
