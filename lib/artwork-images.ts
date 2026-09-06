// Keep image discovery independent of the text provider and the database.
export const MAX_IMAGE_BYTES = 8_000_000;
const headers = {
  'User-Agent':
    'TimelessFlorence/1.0 (https://timeless-florence.haozi-w.workers.dev; art education)',
};
const commons = 'https://commons.wikimedia.org/w/api.php';
const wikidata = 'https://www.wikidata.org/w/api.php';
export class ImageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Statement = {
  rank?: string;
  mainsnak?: { datavalue?: { value: string | { id: string } } };
};
type Entity = {
  id: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Statement[]>;
};
type ImageInfo = {
  url?: string;
  thumburl?: string;
  size?: number;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value: string }>;
};
type Page = { title: string; index?: number; imageinfo?: ImageInfo[] };
type ApiData = {
  error?: unknown;
  search?: { id: string }[];
  entities?: Record<string, Entity>;
  query?: { pages?: Record<string, Page> };
};
export type ArtworkImage = {
  image: string;
  imageCredit: string;
  imageSource: string;
  imageDownloadable: boolean;
  artworkId?: string;
  imageFile: string;
};

async function query(
  base: string,
  params: Record<string, string>,
  signal: AbortSignal,
) {
  const response = await fetch(
    base + '?' + new URLSearchParams({ format: 'json', ...params }),
    { headers, signal, redirect: 'manual' },
  );
  if (!response.ok)
    throw new ImageError(
      502,
      response.status === 429
        ? '图片来源请求繁忙，请稍后重试。'
        : '图片来源暂时无法连接，请稍后重试。',
    );
  const data = (await response.json()) as ApiData;
  if (data.error) throw new ImageError(502, '图片资料查询失败，请稍后重试。');
  return data;
}

export function imageHostUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

export function commonsFile(raw: string): string {
  const url = imageHostUrl(raw);
  // Accept actual Commons originals/thumbnails only, including SVG/TIFF rendered as PNG/JPEG.
  const match = url?.pathname.match(
    /^\/wikipedia\/commons\/(?:thumb\/)?[a-f0-9]\/[a-f0-9]{2}\/([^/]+)(?:\/[^/]+)?$/i,
  );
  if (!match) throw new ImageError(400, '图片来源不受支持。');
  let name: string;
  try {
    name = decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch {
    throw new ImageError(400, '图片地址无效。');
  }
  if (
    !/\.(jpe?g|png|webp|svg|tiff?)$/i.test(name) ||
    /[/\\|#]/.test(name) ||
    name.split('').some((c) => c.charCodeAt(0) < 32)
  )
    throw new ImageError(400, '图片格式不受支持。');
  return 'File:' + name;
}

export async function fileInfo(
  file: string,
  width: number,
  signal: AbortSignal,
): Promise<ImageInfo> {
  const data = await query(
    commons,
    {
      action: 'query',
      titles: file,
      redirects: '1',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(width),
    },
    signal,
  );
  const info = Object.values(data.query?.pages ?? {}).find(
    (p) => p.imageinfo?.length,
  )?.imageinfo?.[0];
  if (!info) throw new ImageError(404, '该图片已不可用，请重新获取图片。');
  return info;
}

function publicDomain(info: ImageInfo) {
  return /^(public domain|cc0(?: 1\.0)?|pd-art|pd-old(?:-\d+)?|pd-us)$/i.test(
    info.extmetadata?.LicenseShortName?.value?.trim() ?? '',
  );
}

function metadata(
  file: string,
  info: ImageInfo,
  artworkId?: string,
): ArtworkImage | null {
  if (!publicDomain(info)) return null;
  const url =
    imageHostUrl(info.thumburl) ??
    (Number(info.size) > 0 &&
    Number(info.size) <= MAX_IMAGE_BYTES &&
    /^image\/(jpeg|png|webp)$/.test(info.mime ?? '')
      ? imageHostUrl(info.url)
      : null);
  if (!url) return null;
  return {
    image: url.href,
    imageFile: file,
    artworkId,
    imageDownloadable: true,
    imageCredit: `${artworkId ? '作品图片' : '相关资料图片（请核对作品版本）'} · ${info.extmetadata!.LicenseShortName.value} · Wikimedia Commons`,
    imageSource:
      'https://commons.wikimedia.org/wiki/' +
      encodeURIComponent(file.replace(/ /g, '_')),
  };
}

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}]/gu, '');
const names = (entity: Entity) => [
  ...Object.values(entity.labels ?? {}).map((x) => x.value),
  ...Object.values(entity.aliases ?? {})
    .flat()
    .map((x) => x.value),
];
function values(entity: Entity, property: 'P170'): { id: string }[];
function values(entity: Entity, property: 'P18'): string[];
function values(entity: Entity, property: 'P170' | 'P18') {
  return (entity.claims?.[property] ?? [])
    .filter((x) => x.rank !== 'deprecated')
    .sort(
      (a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'),
    )
    .map((x) => x.mainsnak?.datavalue?.value)
    .filter((x) =>
      property === 'P18'
        ? typeof x === 'string'
        : !!x && typeof x === 'object' && /^Q\d+$/.test(x.id),
    );
}

export async function artworkImage(work: {
  title: string;
  originalTitle?: string;
  creator?: string;
  imageQuery?: string;
}): Promise<ArtworkImage | null> {
  const signal = AbortSignal.timeout(25000);
  const titles = [
    ...new Set(
      [work.originalTitle, work.title, work.imageQuery]
        .filter((x): x is string => !!x?.trim())
        .map((x) => x.slice(0, 120)),
    ),
  ];
  const ids = new Set<string>();
  // Search both the user's language and canonical names/aliases, then verify creator.
  const searches = await Promise.allSettled(
    titles
      .slice(0, 3)
      .map((search) =>
        query(
          wikidata,
          {
            action: 'wbsearchentities',
            search,
            language: /\p{Script=Han}/u.test(search) ? 'zh' : 'en',
            uselang: 'en',
            type: 'item',
            limit: '5',
          },
          signal,
        ),
      ),
  );
  for (const result of searches)
    if (result.status === 'fulfilled')
      for (const hit of result.value.search ?? [])
        if (/^Q\d+$/.test(hit.id)) ids.add(hit.id);
  if (ids.size) {
    const data = await query(
      wikidata,
      {
        action: 'wbgetentities',
        ids: [...ids].join('|'),
        props: 'labels|aliases|claims',
        languages: 'zh|zh-hans|zh-hant|en|it|fr|ja|mul',
      },
      signal,
    );
    const entities = Object.values(data.entities ?? {}) as Entity[];
    const creatorIds = [
      ...new Set(
        entities
          .flatMap((e) => values(e, 'P170').map((v) => v.id as string))
          .filter(Boolean),
      ),
    ];
    const creators = creatorIds.length
      ? ((
          await query(
            wikidata,
            {
              action: 'wbgetentities',
              ids: creatorIds.join('|'),
              props: 'labels|aliases',
              languages: 'zh|zh-hans|zh-hant|en|it|fr|ja|mul',
            },
            signal,
          )
        ).entities ?? {})
      : {};
    const exact = entities.filter(
      (e) =>
        names(e).some((n) =>
          titles.some((t) => normalize(t) === normalize(n)),
        ) &&
        (!work.creator ||
          values(e, 'P170').some(
            (v) =>
              creators[v.id] &&
              names(creators[v.id]).some((n) => {
                const a = normalize(n),
                  b = normalize(work.creator!);
                return (
                  a === b ||
                  (Math.min(a.length, b.length) >= 3 &&
                    (a.includes(b) || b.includes(a)))
                );
              }),
          )),
    );
    // Do not silently choose between multiple same-title works by the same creator.
    if (exact.length === 1)
      for (const file of values(exact[0], 'P18').slice(0, 2)) {
        const name = 'File:' + file;
        const info = await fileInfo(name, 1200, signal);
        const image = metadata(name, info, exact[0].id);
        if (image) return image;
      }
  }
  // Fallback is explicitly labelled as related imagery, never asserted as an identity match.
  const search = `${titles[0]} ${work.creator ?? ''}`.slice(0, 200);
  const data = await query(
    commons,
    {
      action: 'query',
      generator: 'search',
      gsrsearch: search + ' filetype:bitmap',
      gsrnamespace: '6',
      gsrlimit: '5',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1200',
    },
    signal,
  );
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
  );
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (info) {
      const image = metadata(page.title, info);
      if (image) return image;
    }
  }
  return null;
}

export async function readImage(response: Response): Promise<Blob> {
  const type = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (
    !response.ok ||
    !response.body ||
    !/^image\/(jpeg|png|webp)$/.test(type)
  ) {
    await response.body?.cancel();
    throw new ImageError(
      502,
      response.status === 429
        ? '图片来源请求繁忙，请稍后重试。'
        : '图片未能下载，请重试。',
    );
  }
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw new ImageError(413, '图片过大，正在尝试较小尺寸。');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ImageError(413, '图片过大，正在尝试较小尺寸。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks as BlobPart[], { type });
  const magic = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const valid =
    type === 'image/jpeg'
      ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
      : type === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => magic[i] === v)
        : String.fromCharCode(...magic.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...magic.slice(8, 12)) === 'WEBP';
  if (!valid) throw new ImageError(502, '下载内容不是有效图片，请重试。');
  return blob;
}

async function fetchImage(source: URL, signal: AbortSignal): Promise<Response> {
  let current = source;
  for (let redirects = 0; redirects <= 3; redirects++) {
    // Workers supports manual/follow only. Validate every redirect before fetching it.
    const response = await fetch(current, {
      headers,
      signal,
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    let next: URL | null = null;
    try {
      if (location) next = imageHostUrl(new URL(location, current).href);
    } catch {
      /* Invalid redirect. */
    }
    if (!next || redirects === 3)
      throw new ImageError(502, '图片来源跳转无效，请重新获取图片。');
    commonsFile(next.href);
    current = next;
  }
  throw new ImageError(502, '图片来源跳转过多。');
}

export async function downloadArtwork(
  file: string,
): Promise<{ blob: Blob; source: string }> {
  const signal = AbortSignal.timeout(25000);
  let lastError: unknown;
  const tried = new Set<string>();
  for (const width of [1200, 640]) {
    try {
      const info = await fileInfo(file, width, signal);
      const source =
        imageHostUrl(info.thumburl) ??
        (Number(info.size) <= MAX_IMAGE_BYTES ? imageHostUrl(info.url) : null);
      if (!source || tried.has(source.href)) continue;
      tried.add(source.href);
      const response = await fetchImage(source, signal);
      if (response.status === 429) {
        await response.body?.cancel();
        throw new ImageError(429, '图片来源请求繁忙，请稍后重试。');
      }
      return { blob: await readImage(response), source: source.href };
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        (error instanceof ImageError && [404, 429].includes(error.status))
      )
        break;
    }
  }
  if (lastError instanceof ImageError) throw lastError;
  console.warn(
    'Artwork download failed',
    lastError instanceof Error ? lastError.message : 'No supported preview',
  );
  throw new ImageError(502, '图片来源连接超时或不可用，请稍后重试。');
}
