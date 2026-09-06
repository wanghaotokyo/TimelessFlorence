import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  fs.readFileSync(new URL('../lib/local.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { downloadGuide, listLocal } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
const records = new Map();
// Asynchronous IndexedDB transaction fixture: assertions concern persisted user data.
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        transaction() {
          const tx = {
            objectStore() {
              return {
                put(row) {
                  records.set(row.key, structuredClone(row));
                  queueMicrotask(() => tx.oncomplete?.());
                },
                getAll() {
                  const r = {};
                  queueMicrotask(() => {
                    r.result = [...records.values()];
                    r.onsuccess();
                  });
                  return r;
                },
              };
            },
          };
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    serviceWorker: {
      ready: Promise.resolve(),
      controller: {
        postMessage(_message, ports) {
          ports[0].postMessage({ ok: true });
          ports[0].close();
        },
      },
    },
    storage: { persist: async () => true },
  },
});
globalThis.document = { querySelectorAll: () => [] };
globalThis.createImageBitmap = async () => ({ close() {} });
const realFetch = globalThis.fetch;
const guide = {
  id: 'painting',
  title: '蒙娜丽莎',
  originalTitle: 'Mona Lisa',
  creator: '达芬奇',
  image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Mona.jpg',
  imageDownloadable: true,
  sections: [{ title: '介绍', text: '保留这段讲解' }],
  speech: '保留口播',
  version: 1,
};
test.afterEach(() => {
  globalThis.fetch = realFetch;
  records.clear();
});

test('image failure still persists text, then image-only retry completes the same guide', async () => {
  globalThis.fetch = async () =>
    Response.json({ error: '图片来源请求繁忙，请稍后重试。' }, { status: 502 });
  const failed = await downloadGuide('owner', guide);
  assert.equal(failed.offline, true);
  assert.equal(failed.imageStatus, 'pending');
  assert.equal(failed.imageBlob, undefined);
  assert.deepEqual(
    (await listLocal('owner'))[0].guide.sections,
    guide.sections,
  );
  assert.match(failed.imageError, /繁忙/);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method });
    return options?.method === 'POST'
      ? Response.json({ image: guide.image, imageDownloadable: true })
      : new Response(new Uint8Array([255, 216, 255, 0]), {
          headers: { 'content-type': 'image/jpeg' },
        });
  };
  const saved = await downloadGuide('owner', guide, failed, true);
  assert.equal(saved.imageStatus, 'ready');
  assert.equal(saved.imageBlob.size, 4);
  assert.equal(saved.imageHash.length, 64);
  assert.equal(saved.guide.speech, guide.speech);
  assert.equal(records.size, 1);
  assert.ok(calls.every((x) => !x.url.includes('/jobs')));
});

test('failed refresh preserves the previous working offline image', async () => {
  const blob = new Blob([new Uint8Array([255, 216, 255])], {
    type: 'image/jpeg',
  });
  const previous = {
    key: 'owner:painting',
    owner: 'owner',
    guide,
    offline: true,
    imageBlob: blob,
    imageHash: 'old-hash',
    bytes: 3,
  };
  globalThis.fetch = async () =>
    Response.json({ error: '暂时无法连接' }, { status: 502 });
  const result = await downloadGuide('owner', guide, previous, true);
  assert.equal(result.imageStatus, 'ready');
  assert.equal(result.imageBlob.size, 3);
  assert.equal(result.imageHash, 'old-hash');
  assert.equal(result.guide.image, guide.image);
});

test('existing guides without an image are repaired without regenerating text', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    return options?.method === 'POST'
      ? Response.json({
          image: guide.image,
          imageDownloadable: true,
          artworkId: 'Q12418',
        })
      : new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } });
  };
  const saved = await downloadGuide('owner', {
    ...guide,
    image: null,
    imageDownloadable: false,
  });
  assert.equal(saved.imageStatus, 'ready');
  assert.equal(saved.guide.artworkId, 'Q12418');
  assert.equal(saved.guide.speech, guide.speech);
  assert.equal(calls[0], '/api/history/painting/image');
});

test('a complete offline image is reused when reopening the guide', async () => {
  globalThis.fetch = async () => {
    assert.fail('reopening should not refetch an existing blob');
  };
  const previous = {
    guide,
    offline: true,
    imageBlob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    imageHash: 'saved',
  };
  const saved = await downloadGuide('owner', guide, previous);
  assert.equal(saved.imageStatus, 'ready');
  assert.equal(saved.imageHash, 'saved');
});

test('browser decode failure does not label the image as saved', async () => {
  globalThis.fetch = async () =>
    new Response('broken', { headers: { 'content-type': 'image/jpeg' } });
  const decode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => {
    throw new Error('Cannot decode image');
  };
  try {
    const saved = await downloadGuide('owner', guide);
    assert.equal(saved.imageStatus, 'pending');
    assert.equal(saved.imageBlob, undefined);
    assert.equal(saved.offline, true);
  } finally {
    globalThis.createImageBitmap = decode;
  }
});
