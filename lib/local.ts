import type { Guide } from './types';
export type LocalGuide={key:string;owner:string;guide:Guide;offline:boolean;imageBlob?:Blob;imageHash?:string;imageStatus?:'ready'|'pending'|'unavailable';imageError?:string;bytes:number;pending?:'rename'|'delete';conflict?:{title:string;version:number}};
let connection:Promise<IDBDatabase>|undefined;
function database(){if(!connection)connection=new Promise((resolve,reject)=>{const r=indexedDB.open('timeless-florence',1);r.onupgradeneeded=()=>{r.result.createObjectStore('guides',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=undefined;reject(new Error('无法打开本机存储，请检查浏览器隐私设置。'));};});return connection;}
export async function listLocal(owner:string):Promise<LocalGuide[]>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('guides');const r=tx.objectStore('guides').getAll();r.onsuccess=()=>resolve(r.result.filter((x:LocalGuide)=>x.owner===owner));r.onerror=()=>reject(r.error);});}
export async function putLocal(row:LocalGuide){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('guides','readwrite');tx.objectStore('guides').put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('保存失败，可能是本机空间不足。'));tx.onerror=()=>reject(new Error('无法保存到本机。'));});}
export async function removeLocal(key:string){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('guides','readwrite');tx.objectStore('guides').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export async function clearOwner(owner:string){for(const row of await listLocal(owner))await removeLocal(row.key);}
export const imageUrl=(guide:Guide)=>guide.image?.startsWith('https://')?'/api/image?url='+encodeURIComponent(guide.image):guide.image;
export async function downloadGuide(owner:string,guide:Guide,previous?:LocalGuide,repair=false){
  if(!('serviceWorker' in navigator))throw new Error('当前浏览器不支持离线页面，请换用新版浏览器。');
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('离线页面尚未就绪，请刷新页面后再保存。')),8000);navigator.serviceWorker.ready.then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);reject(new Error('离线页面准备失败，请刷新重试。'));});});
  // The shell and its current application chunks must be available before claiming offline readiness.
  const controller=navigator.serviceWorker.controller;
  if(!controller)throw new Error('离线功能正在首次准备，请刷新页面后再保存。');
  await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('离线页面准备超时，请重试。')),20000);channel.port1.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve():reject(new Error('离线页面未能完整保存，请联网重试。'));};controller.postMessage({type:'PREPARE_OFFLINE',assets:Array.from(document.querySelectorAll('script[src],link[rel="stylesheet"]')).map(el=>(el as HTMLScriptElement).src||(el as HTMLLinkElement).href).filter(Boolean)},[channel.port2]);});
  // Commit text before any external image request; a failed image can be retried independently.
  const reusable=previous?.guide.image===guide.image ? previous?.imageBlob : undefined;
  let row:LocalGuide={...previous,key:`${owner}:${guide.id}`,owner,guide,offline:true,imageBlob:reusable,imageHash:reusable?previous?.imageHash:undefined,imageStatus:reusable?'ready':'pending',imageError:undefined,bytes:new Blob([JSON.stringify(guide)]).size+(reusable?.size??0)};
  await putLocal(row);
  try {
    if(!guide.demo&&(repair||!guide.image)){
      const response=await fetch('/api/history/'+encodeURIComponent(guide.id)+'/image',{method:'POST',signal:AbortSignal.timeout(30000)});
      const data=await response.json() as Pick<Guide,'image'|'imageCredit'|'imageSource'|'imageDownloadable'|'imageFile'|'artworkId'> & {error?:string};
      if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'图片资料暂时无法获取，请重试。');
      guide={...guide,...data};
      if(!row.imageBlob)row={...row,guide};
    }
    const url=imageUrl(guide);
    if(!url||!guide.imageDownloadable){row={...row,guide,imageStatus:'unavailable',imageError:'暂未找到可离线保存的图片。'};}
    else if(!reusable||repair){
      const response=await fetch(url,{signal:AbortSignal.timeout(30000),cache:repair?'reload':'default'});
      if(!response.ok){const error=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(error?.error||'图片下载失败，请稍后重试。');}
      const blob=await response.blob();
      if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||!blob.size||blob.size>8e6)throw new Error('图片内容无效或过大。');
      if(typeof createImageBitmap==='function'){const decoded=await createImageBitmap(blob);decoded.close();}
      const imageHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
      row={...row,guide,imageBlob:blob,imageHash,imageStatus:'ready',imageError:undefined};
    }
  }catch(error){row={...row,imageStatus:row.imageBlob?'ready':'pending',imageError:error instanceof Error?error.message:'图片下载失败，请稍后重试。'};}
  row.bytes=new Blob([JSON.stringify(row.guide)]).size+(row.imageBlob?.size??0);
  await navigator.storage?.persist?.().catch(()=>false);
  await putLocal(row);return row;
}
export async function syncHistory(owner:string){
  const pending=(await listLocal(owner)).filter(r=>r.pending);
  for(const r of pending){
    if(r.guide.demo)continue;
    const response=await fetch('/api/history/'+encodeURIComponent(r.guide.id),{method:r.pending==='delete'?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},body:r.pending==='rename'?JSON.stringify({title:r.guide.title,version:r.guide.version}):undefined});
    if(response.status===401)throw new Error('登录已过期，请重新登录后同步。');
    if(response.status===409){const data=await response.json() as any;await putLocal({...r,conflict:data.current});continue;}
    if(response.status===404||r.pending==='delete'&&response.ok){await removeLocal(r.key);continue;}
    if(!response.ok)throw new Error('同步未完成，修改已保存在本机。');
    const data=await response.json() as any;await putLocal({...r,pending:undefined,conflict:undefined,guide:{...r.guide,version:data.version}});
  }
  const response=await fetch('/api/history');if(!response.ok)throw new Error(response.status===401?'请重新登录以同步履历。':'暂时无法同步履历，已保存资料仍可使用。');
  const remote=await response.json() as any[];const local=await listLocal(owner);
  for(const g of remote){const existing=local.find(r=>r.guide.id===g.id);if(g.deleted){if(existing)await removeLocal(existing.key);continue;}if(existing?.pending)continue;await putLocal({...existing,key:`${owner}:${g.id}`,owner,guide:g,offline:existing?.offline??false,bytes:existing?.bytes??0});}
  return listLocal(owner);
}

