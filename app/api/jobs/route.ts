import { body, db, handler, HttpError, json, requireUser, runtime, sameOrigin } from '@/lib/server';
import { fail, startJob, type JobRow } from '@/lib/generation';
export async function POST(req:Request){return handler(async()=>{
  sameOrigin(req);const u=await requireUser(req);const env=runtime();if(!env.OPENAI_API_KEY||!env.OPENAI_MODEL)throw new HttpError(503,'作品生成服务尚未配置，可以先体验精选中文讲解。');
  const b=await body(req);if(!['resolve','generate'].includes(b.kind)||typeof b.id!=='string'||!/^[\da-f-]{36}$/i.test(b.id))throw new HttpError(400,'请求参数无效。');
  const existing=await db().prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').bind(b.id,u.id).first<JobRow>();if(existing)return json({id:existing.id,state:existing.state});
  let payload:Record<string,unknown>;
  if(b.kind==='resolve'){if(typeof b.query!=='string'||!b.query.trim()||b.query.length>1000)throw new HttpError(400,'请输入 1–1000 字的作品线索。');payload={query:b.query.trim()};}
  else {
    if(!['zh','ja','en'].includes(b.language)||![2,5,15].includes(b.duration)||!Number.isInteger(b.candidateIndex))throw new HttpError(400,'语言或时长无效。');
    const previous=await db().prepare("SELECT result FROM jobs WHERE id=? AND user_id=? AND kind='resolve' AND state='completed'").bind(b.resolveId??'',u.id).first<{result:string}>();
    const candidate=previous?JSON.parse(previous.result).candidates[b.candidateIndex]:null;if(!candidate)throw new HttpError(400,'请先识别并确认作品。');payload={candidate,language:b.language,duration:b.duration};
  }
  const now=Date.now(),day=now-(now%86400000);const limit=Math.max(1,Math.min(Number(env.DAILY_JOB_LIMIT)||10,1000)),global=Math.max(1,Math.min(Number(env.GLOBAL_DAILY_JOB_LIMIT)||100,10000));
  const inserted=await db().prepare("INSERT INTO jobs (id,user_id,kind,state,payload,created,updated) SELECT ?,?,?,'starting',?,?,? WHERE (SELECT COUNT(*) FROM jobs WHERE user_id=? AND created>=?) < ? AND (SELECT COUNT(*) FROM jobs WHERE created>=?) < ? AND (SELECT COUNT(*) FROM jobs WHERE user_id=? AND state IN ('starting','research','formatting','processing') AND created>?) < 2 ON CONFLICT(id) DO NOTHING").bind(b.id,u.id,b.kind,JSON.stringify(payload),now,now,u.id,day,limit,day,global,u.id,now-15*60000).run();
  if(!inserted.meta.changes)throw new HttpError(429,'今日生成额度或同时处理数量已达上限，请稍后重试。');
  const job=await db().prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').bind(b.id,u.id).first<JobRow>();
  try{await startJob(job!);}catch(e){await fail(b.id,e instanceof HttpError?e.message:'文字服务请求失败，请重试。');throw e;}
  return json({id:b.id,state:'research'},202);
});}
