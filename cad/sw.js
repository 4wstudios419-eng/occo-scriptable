const CACHE="atlas-cad-v4";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.json"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;}).catch(()=>caches.match(event.request)));});
