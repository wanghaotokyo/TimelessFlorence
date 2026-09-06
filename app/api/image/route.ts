import { handler, HttpError } from '@/lib/server';
export async function GET(req:Request){return handler(async()=>{
  const raw=new URL(req.url).searchParams.get('url');let u:URL;try{u=new URL(raw??'');}catch{throw new HttpError(400,'图片地址无效。');}
  if(u.protocol!=='https:'||u.hostname!=='upload.wikimedia.org'||u.username||u.password||!u.pathname.startsWith('/wikipedia/')||!/\.(jpg|jpeg|png|webp)$/i.test(u.pathname))throw new HttpError(400,'图片来源不受支持。');
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'TimelessFlorence/0.1'}});const type=r.headers.get('content-type')??'';
  if(!r.ok||!/^image\/(jpeg|png|webp)$/.test(type)||Number(r.headers.get('content-length')??0)>8e6)throw new HttpError(502,'图片暂时无法读取。');
  const reader=r.body!.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8e6){await reader.cancel();throw new HttpError(413,'图片过大。');}chunks.push(value);}
  return new Response(new Blob(chunks as BlobPart[],{type}),{headers:{'Content-Type':type,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
});}
