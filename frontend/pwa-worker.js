// This worker deliberately never stores application pages, bundles or private responses.
const CACHE = 'norns-public-__BUILD__';
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html'])));
 // Natural waiting is the update barrier across ALL open tabs. Never skipWaiting.
});
self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('norns-public-') && key !== CACHE).map(key => caches.delete(key)))));
 // No claim: never change a live document's controller underneath its editors.
});
self.addEventListener('fetch', event => {
 const request = event.request, url = new URL(request.url);
 if(request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname !== '/' || url.search) return;
 event.respondWith(fetch(request).catch(async () => {
  const cached = await caches.match('/offline.html', {cacheName:CACHE});
  return new Response(cached ? await cached.text() : 'Norns 无法连接。请恢复网络后重试。', {
   status:503, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}
  });
 }));
});
