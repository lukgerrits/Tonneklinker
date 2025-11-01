
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('tonneklinker-v8').then(cache => cache.addAll([
      './','./index.html','./mobile.html','./styles.css',
      './app.js','./mobile.js','./manifest.webmanifest',
      './icon-192.png','./icon-256.png','./icon-512.png'
    ]))
  );
});
self.addEventListener('activate', (e) => self.clients.claim());
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
