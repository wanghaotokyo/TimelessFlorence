import { HttpError } from './server';
import {
  EDGE_TTS_PITCH,
  EDGE_TTS_RATE,
  edgeVoiceCandidates,
} from './tts-voices';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const EDGE_EXTENSION_ORIGIN =
  'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';

const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanXml(text: string): string {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    ' ',
  );
}

function makeMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function edgeTimestamp(): string {
  const now = new Date();
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  return `${weekdays[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2, '0')} ${now.getUTCFullYear()} ${time} GMT+0000 (Coordinated Universal Time)`;
}

async function openSpeechSocket(
  connectionId: string,
  gec: string,
  muid: string,
): Promise<WebSocket> {
  const endpoints = [
    {
      url: `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
      protocol: false,
    },
    {
      url: `https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`,
      protocol: true,
    },
  ];
  let lastStatus = 0;

  for (const [endpointIndex, endpoint] of endpoints.entries()) {
    const headers: Record<string, string> = {
      Upgrade: 'websocket',
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: EDGE_EXTENSION_ORIGIN,
      'Sec-WebSocket-Version': '13',
      Cookie: `MUID=${muid}`,
    };
    if (endpoint.protocol) headers['Sec-WebSocket-Protocol'] = 'synthesize';

    const response = (await fetch(endpoint.url, { headers })) as Response & {
      webSocket?: WebSocket;
    };
    if (response.webSocket) return response.webSocket;
    lastStatus = response.status;
    console.error(
      'Edge TTS upstream handshake rejected',
      `endpoint=${endpointIndex + 1}`,
      `status=${response.status}`,
    );
  }

  throw new HttpError(
    502,
    `无法连接语音服务（上游状态 ${lastStatus || '未知'}）。`,
  );
}

async function makeSecMsGec(): Promise<string> {
  const winEpoch = 11644473600;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function synthesizeWithVoice(
  text: string,
  voice: string,
): Promise<ArrayBuffer> {
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const gec = await makeSecMsGec();
  const muid = makeMuid();

  const ws = await openSpeechSocket(connectionId, gec, muid);
  ws.accept();
  ws.binaryType = 'arraybuffer';

  const timestamp = edgeTimestamp();
  const config = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(
    {
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: 'false',
              wordBoundaryEnabled: 'false',
            },
            outputFormat: AUDIO_FORMAT,
          },
        },
      },
    },
  )}\r\n`;
  const requestId = crypto.randomUUID().replace(/-/g, '');
  // The free Edge consumer endpoint rejects Azure's mstts:express-as extension.
  // The calm profile is therefore expressed with a female voice and restrained prosody.
  const ssml = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${escapeXml(voice)}'><prosody rate='${EDGE_TTS_RATE}' pitch='${EDGE_TTS_PITCH}' volume='+0%'>${escapeXml(cleanXml(text))}</prosody></voice></speak>`;

  return new Promise<ArrayBuffer>((resolve, reject) => {
    let done = false;
    const chunks: ArrayBuffer[] = [];
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      reject(new HttpError(502, '语音生成超时。'));
    }, 15000);

    ws.addEventListener('message', (event: MessageEvent) => {
      if (done) return;
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          done = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          if (!chunks.length) {
            reject(new HttpError(502, '未收到语音数据。'));
            return;
          }
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const result = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
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

    ws.addEventListener('close', (event: CloseEvent) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(
        new HttpError(
          502,
          `语音服务连接意外关闭（${event.code}${event.reason ? `：${event.reason}` : ''}）。`,
        ),
      );
    });

    // Install listeners before sending because short utterances can complete quickly.
    ws.send(config);
    ws.send(ssml);
  });
}

export async function synthesize(
  text: string,
  requestedVoice?: string,
): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (const voice of edgeVoiceCandidates(requestedVoice)) {
    try {
      return await synthesizeWithVoice(text, voice);
    } catch (error) {
      lastError = error;
      console.warn('Edge TTS voice failed', voice, error);
    }
  }
  throw lastError;
}
