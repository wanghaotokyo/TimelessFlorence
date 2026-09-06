import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  fs.readFileSync(new URL('../lib/artwork-images.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { artworkImage, commonsFile, downloadArtwork, readImage } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
const original =
  'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg';
const thumb =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mona_Lisa.jpg/1200px-Mona_Lisa.jpg';
const jpeg = () =>
  new Response(new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217]), {
    headers: { 'content-type': 'image/jpeg; charset=binary' },
  });
const info = (overrides = {}) => ({
  url: original,
  thumburl: thumb,
  size: 15_000_000,
  mime: 'image/jpeg',
  extmetadata: { LicenseShortName: { value: 'Public domain' } },
  ...overrides,
});
const imageResponse = (i) =>
  Response.json({ query: { pages: { 1: { imageinfo: [i] } } } });
const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('old originals and new thumbnails resolve to the same Commons file', () => {
  assert.equal(commonsFile(original), 'File:Mona Lisa.jpg');
  assert.equal(commonsFile(thumb), commonsFile(original));
  assert.equal(
    commonsFile(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Painting.svg/1200px-Painting.svg.png',
    ),
    'File:Painting.svg',
  );
  for (const url of [
    'http://127.0.0.1/x.jpg',
    'https://evil.example/a.jpg',
    'https://upload.wikimedia.org:8080/wikipedia/commons/6/6a/a.jpg',
    'https://user:pass@upload.wikimedia.org/wikipedia/commons/6/6a/a.jpg',
    'https://upload.wikimedia.org/wikipedia/en/6/6a/a.jpg',
    original.replace('Mona_Lisa', '%2Fprivate'),
    original.replace('Mona_Lisa', '%ZZ'),
  ])
    assert.throws(() => commonsFile(url));
});

test('15 MB Mona Lisa original is never fetched when a preview is available', async () => {
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    return url.includes('/w/api.php') ? imageResponse(info()) : jpeg();
  };
  const result = await downloadArtwork(commonsFile(original));
  assert.equal(result.source, thumb);
  assert.equal(result.blob.type, 'image/jpeg');
  assert.ok(!seen.includes(original));
});

test('oversize preview retries a smaller API-provided size', async () => {
  const widths = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('api.php')) {
      const w = url.searchParams.get('iiurlwidth');
      widths.push(w);
      return imageResponse(
        info({ thumburl: thumb.replace('1200px', w + 'px') }),
      );
    }
    return url.pathname.includes('1200px')
      ? new Response('large', {
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '9000000',
          },
        })
      : jpeg();
  };
  const result = await downloadArtwork('File:Mona Lisa.jpg');
  assert.deepEqual(widths, ['1200', '640']);
  assert.ok(result.source.includes('640px'));
});

test('HTML masquerading as image, empty responses, SVG originals and oversize streams are rejected', async () => {
  await assert.rejects(
    readImage(
      new Response('<html>error</html>', {
        headers: { 'content-type': 'image/jpeg' },
      }),
    ),
  );
  await assert.rejects(
    readImage(new Response('', { headers: { 'content-type': 'image/png' } })),
  );
  await assert.rejects(
    readImage(
      new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    ),
  );
  await assert.rejects(
    readImage(
      new Response(new Uint8Array(8_000_001), {
        headers: { 'content-type': 'image/jpeg' },
      }),
    ),
    { status: 413 },
  );
});

test('rate limiting stops retries instead of hammering the image server', async () => {
  let images = 0;
  globalThis.fetch = async (input) =>
    String(input).includes('api.php')
      ? imageResponse(info())
      : (images++, new Response('busy', { status: 429 }));
  await assert.rejects(downloadArtwork('File:Mona Lisa.jpg'), { status: 429 });
  assert.equal(images, 1);
});

for (const title of ['蒙娜丽莎', 'Mona Lisa', 'Monna Lisa'])
  test(`${title} resolves to the same artwork and preview, not the wrong artist`, async () => {
    const entity = (id, creator) => ({
      id,
      labels: { zh: { value: '蒙娜丽莎' }, en: { value: 'Mona Lisa' } },
      aliases: { mul: [{ value: 'Monna Lisa' }] },
      claims: {
        P18: [{ mainsnak: { datavalue: { value: 'Mona Lisa.jpg' } } }],
        P170: [{ mainsnak: { datavalue: { value: { id: creator } } } }],
      },
    });
    globalThis.fetch = async (input) => {
      const u = new URL(input),
        action = u.searchParams.get('action');
      if (action === 'wbsearchentities')
        return Response.json({ search: [{ id: 'Q999' }, { id: 'Q12418' }] });
      if (
        action === 'wbgetentities' &&
        u.searchParams.get('props').includes('claims')
      )
        return Response.json({
          entities: {
            Q999: entity('Q999', 'Q2'),
            Q12418: entity('Q12418', 'Q762'),
          },
        });
      if (action === 'wbgetentities')
        return Response.json({
          entities: {
            Q2: { labels: { en: { value: 'Other artist' } } },
            Q762: {
              labels: {
                zh: { value: '列奥纳多·达·芬奇' },
                en: { value: 'Leonardo da Vinci' },
              },
            },
          },
        });
      return imageResponse(info());
    };
    const image = await artworkImage({ title, creator: '达·芬奇' });
    assert.equal(image.artworkId, 'Q12418');
    assert.equal(image.image, thumb);
    assert.equal(image.imageDownloadable, true);
  });

test('missing entity uses Commons search rank, skipping unsupported and non-public-domain originals', async () => {
  globalThis.fetch = async (input) =>
    new URL(input).searchParams.get('action') === 'wbsearchentities'
      ? Response.json({ search: [] })
      : Response.json({
          query: {
            pages: {
              1: {
                title: 'File:Unlicensed.jpg',
                index: 1,
                imageinfo: [
                  info({
                    extmetadata: {
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }),
                ],
              },
              2: {
                title: 'File:Unsupported.tif',
                index: 2,
                imageinfo: [info({ thumburl: undefined, mime: 'image/tiff' })],
              },
              99: { title: 'File:Right.jpg', index: 3, imageinfo: [info()] },
            },
          },
        });
  const image = await artworkImage({ title: 'Unknown painting' });
  assert.equal(image.imageFile, 'File:Right.jpg');
  assert.equal(image.artworkId, undefined);
  assert.match(image.imageCredit, /请核对作品版本/);
});

test('preview redirect to an untrusted host is never followed', async () => {
  globalThis.fetch = async (input, options) => {
    assert.equal(options.redirect, 'manual');
    if (String(input).includes('api.php')) return imageResponse(info());
    assert.ok(String(input).startsWith('https://upload.wikimedia.org/'));
    return new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/a.jpg' },
    });
  };
  await assert.rejects(downloadArtwork('File:Mona Lisa.jpg'));
});

test('Workers-compatible manual redirects allow only validated Wikimedia images', async () => {
  const moved = thumb.replace('upload.wikimedia.org', 'thumb.wikimedia.org');
  globalThis.fetch = async (input, options) => {
    assert.equal(options.redirect, 'manual');
    if (String(input).includes('api.php')) return imageResponse(info());
    return String(input) === thumb
      ? new Response(null, { status: 302, headers: { location: moved } })
      : jpeg();
  };
  assert.equal(
    (await downloadArtwork('File:Mona Lisa.jpg')).blob.type,
    'image/jpeg',
  );
});
