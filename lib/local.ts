import type { Guide } from './types';
export type LocalGuide={key:string;owner:string;guide:Guide;offline:boolean;imageBlob?:Blob;imageHash?:string;bytes:number;pending?:'rename'|'delete';conflict?:{title:string;version:number}};
let connection:Promise<IDBDatabase>|undefined;
function database(){if(!connection)connection=new Promise((resolve,reject)=>{const r=indexedDB.open('timeless-florence',1);r.onupgradeneeded=()=>{r.result.createObjectStore('guides',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=undefined;reject(new Error('无法打开本机存储，请检查浏览器隐私设置。'));};});return connection;}
export async function listLocal(owner:string):Promise<LocalGuide[]>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('guides');const r=tx.objectStore('guides').getAll();r.onsuccess=()=>resolve(r.result.filter((x:LocalGuide)=>x.owner===owner));r.onerror=()=>reject(r.error);});}
export async function putLocal(row:LocalGuide){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('guides','readwrite');tx.objectStore('guides').put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('保存失败，可能是本机空间不足。'));tx.onerror=()=>reject(new Error('无法保存到本机。'));});}
export async function removeLocal(key:string){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('guides','readwrite');tx.objectStore('guides').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export async function clearOwner(owner:string){for(const row of await listLocal(owner))await removeLocal(row.key);}
export const imageUrl=(guide:Guide)=>guide.image?.startsWith('https://')?'/api/image?url='+encodeURIComponent(guide.image):guide.image;
export async function downloadGuide(owner:string,guide:Guide,previous?:LocalGuide){
  if(!('serviceWorker' in navigator))throw new Error('当前浏览器不支持离线页面，请换用新版浏览器。');
  await navigator.serviceWorker.ready;
  // The shell and its current application chunks must be available before claiming offline readiness.
  const controller=navigator.serviceWorker.controller;
  if(!controller)throw new Error('离线功能正在首次准备，请刷新页面后再保存。');
  await new Promise<void>((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('离线页面准备超时，请重试。')),20000);channel.port1.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve():reject(new Error('离线页面未能完整保存，请联网重试。'));};controller.postMessage({type:'PREPARE_OFFLINE',assets:Array.from(document.querySelectorAll('script[src],link[rel="stylesheet"]')).map(el=>(el as HTMLScriptElement).src||(el as HTMLLinkElement).href).filter(Boolean)},[channel.port2]);});
  let imageBlob:Blob|undefined;let imageHash:string|undefined;
  const url=imageUrl(guide);if(url&&guide.imageDownloadable){const r=await fetch(url);if(!r.ok)throw new Error('图片下载失败，尚未完成离线保存。');imageBlob=await r.blob();if(!imageBlob.type.startsWith('image/')||!imageBlob.size||imageBlob.size>8e6)throw new Error('图片内容无效或过大。');imageHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await imageBlob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');}
  const bytes=new Blob([JSON.stringify(guide)]).size+(imageBlob?.size??0);
  await navigator.storage?.persist?.().catch(()=>false);
  const row:LocalGuide={...previous,key:`${owner}:${guide.id}`,owner,guide,offline:true,imageBlob,imageHash,bytes};await putLocal(row);return row;
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

