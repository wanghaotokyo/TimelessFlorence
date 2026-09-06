import { handler, HttpError, runtime, digest } from '@/lib/server';
import { commonsFile, downloadArtwork, ImageError } from '@/lib/artwork-images';

const pending = new Map<string, ReturnType<typeof downloadArtwork>>();

export async function GET(req: Request) {
  return handler(async () => {
    try {
      const raw = new URL(req.url).searchParams.get('url');
      if (!raw) throw new HttpError(400, '图片地址无效。');
      // Normalize old original URLs and new thumbnails to the same persistent image.
      const file = commonsFile(raw);
      const key = 'artwork-previews/v1/' + (await digest(file));
      const bucket = runtime().ART_IMAGES;
      const headers = {
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      };
      // Edge cache works without an R2 subscription. R2, when bound, survives eviction.
      const cache =
        typeof caches !== 'undefined'
          ? await caches.open('artwork-previews-v1').catch(() => null)
          : null;
      const cacheKey = new Request(
        new URL('/api/image/cache/' + key, new URL(req.url).origin),
      );
      const cached = await cache?.match(cacheKey).catch(() => undefined);
      // Cache responses have immutable headers; Vinext adds headers when finalizing routes.
      if (cached)
        return new Response(cached.body, {
          status: cached.status,
          headers: new Headers(cached.headers),
        });
      const saved = await bucket?.get(key).catch(() => null);
      if (saved) {
        const response = new Response(saved.body, {
          headers: {
            ...headers,
            'Content-Type': saved.httpMetadata?.contentType ?? 'image/jpeg',
            ETag: saved.httpEtag,
          },
        });
        await cache?.put(cacheKey, response.clone()).catch(() => undefined);
        return response;
      }
      let request = pending.get(key);
      if (!request) {
        request = downloadArtwork(file).finally(() => pending.delete(key));
        pending.set(key, request);
      }
      const { blob, source } = await request;
      // A storage outage must not prevent a successfully downloaded picture from displaying.
      if (bucket)
        await bucket
          .put(key, blob, {
            httpMetadata: { contentType: blob.type },
            customMetadata: { file, source },
          })
          .catch(() => console.warn('Artwork cache write failed'));
      const response = new Response(blob, {
        headers: { ...headers, 'Content-Type': blob.type },
      });
      await cache?.put(cacheKey, response.clone()).catch(() => undefined);
      return response;
    } catch (error) {
      if (error instanceof ImageError)
        throw new HttpError(error.status, error.message);
      throw error;
    }
  });
}
