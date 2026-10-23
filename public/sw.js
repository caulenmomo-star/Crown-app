/* Crown Tools service worker: lets Crown Tools install as an app on PC, Mac, iPhone and Android.
   Online it always loads the newest version from the server (so updates show up right away) and keeps a copy of the
   app's own files; offline it opens that copy. It never touches your data: everything under /api goes straight to
   the server, encrypted, and is never stored here. */
'use strict';
const CACHE = 'crown-app-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'ct-icon-180.png', 'ct-icon-192.png', 'ct-icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/admin')) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => { }); }
    return res;
  }).catch(() => caches.match(r).then(hit => hit || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
