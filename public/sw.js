const VERSION='tf-shell-v202609061052';
const SHELL=['/','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tf-shell-')&&k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()]));});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.includes('signin')||u.pathname.includes('signout'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(r=>{if(r.ok&&r.headers.get('content-type')?.includes('text/html')){const copy=r.clone();event.waitUntil(caches.open(VERSION).then(c=>c.put('/',copy)));}return r;}).catch(()=>caches.match('/')));return;}
 if(/\.(js|css|svg|woff2?|bin|wasm|mjs)$/.test(u.pathname)){event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();event.waitUntil(caches.open(VERSION).then(c=>c.put(event.request,copy)));}return r;})));}
});
self.addEventListener('message',event=>{if(event.data?.type!=='PREPARE_OFFLINE')return;event.waitUntil((async()=>{try{const cache=await caches.open(VERSION);const assets=(event.data.assets||[]).filter(s=>{try{return new URL(s).origin===self.location.origin;}catch{return false;}});await cache.addAll([...new Set([...SHELL,...assets])]);event.ports[0]?.postMessage({ok:true});}catch{event.ports[0]?.postMessage({ok:false});}})());});
