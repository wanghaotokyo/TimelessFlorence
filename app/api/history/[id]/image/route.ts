import {
  db,
  handler,
  HttpError,
  json,
  requireUser,
  sameOrigin,
} from '@/lib/server';
import { artworkImage, ImageError } from '@/lib/artwork-images';
import type { Guide } from '@/lib/types';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handler(async () => {
    sameOrigin(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const row = await db()
      .prepare('SELECT data FROM guides WHERE id=? AND user_id=? AND deleted=0')
      .bind(id, user.id)
      .first<{ data: string }>();
    if (!row) throw new HttpError(404, '这条履历已经删除。');
    const guide = JSON.parse(row.data) as Guide;
    let image;
    try {
      image = await artworkImage(guide);
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof ImageError
          ? error.message
          : '图片资料暂时无法获取，请稍后重试。',
      );
    }
    if (!image)
      throw new HttpError(404, '暂未找到可下载的作品图片，文字已保留。');
    // Enrich image fields only: concurrent renames/deletes and text remain intact.
    const updated = await db()
      .prepare(
        "UPDATE guides SET data=json_set(data,'$.image',?,'$.imageCredit',?,'$.imageSource',?,'$.imageDownloadable',json('true'),'$.imageFile',?,'$.artworkId',?) WHERE id=? AND user_id=? AND deleted=0",
      )
      .bind(
        image.image,
        image.imageCredit,
        image.imageSource,
        image.imageFile,
        image.artworkId ?? null,
        id,
        user.id,
      )
      .run();
    if (!updated.meta.changes) throw new HttpError(404, '这条履历已经删除。');
    return json(image);
  });
}
