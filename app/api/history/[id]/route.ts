import { body, db, handler, HttpError, json, requireUser, sameOrigin } from '@/lib/server';
import { validateTitle } from '@/lib/types';
export async function PATCH(req: Request, ctx: { params: Promise<{id:string}> }) { return handler(async () => {
  sameOrigin(req);const u=await requireUser(req);const {id}=await ctx.params;const b=await body(req);let title:string;try{title=validateTitle(b.title);}catch{throw new HttpError(400,'标题请输入 1–100 个字符。');}
  const result=await db().prepare('UPDATE guides SET title=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND deleted=0').bind(title,id,u.id,b.version).run();
  if(!result.meta.changes){const r=await db().prepare('SELECT title,version,deleted FROM guides WHERE id=? AND user_id=?').bind(id,u.id).first();if(!r||r.deleted)throw new HttpError(404,'这条履历已经删除。');return json({error:'标题已在另一设备修改，请重新选择。',current:r},409);}
  return json({title,version:b.version+1});
}); }
export async function DELETE(req: Request, ctx:{params:Promise<{id:string}>}) { return handler(async()=>{sameOrigin(req);const u=await requireUser(req);const {id}=await ctx.params;await db().prepare("UPDATE guides SET deleted=1,version=version+1,data='{}' WHERE id=? AND user_id=? AND deleted=0").bind(id,u.id).run();return json({ok:true});}); }
