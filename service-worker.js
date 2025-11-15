
const CACHE_VERSION = '71';
const CACHE_NAME = `tonneklinker-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './mobile.html',
  './styles.css',
  './app.js',
  './mobile.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-256.png',
  './icon-512.png'
];

// ------------------------------------------------------
// INSTALL — Cache app shell
// ------------------------------------------------------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ------------------------------------------------------
// ACTIVATE — Remove old caches
// ------------------------------------------------------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('tonneklinker-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ------------------------------------------------------
// FETCH — Network-first for API, cache-first for local assets
// ------------------------------------------------------
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Do NOT cache Airtable API calls
  if (url.hostname.includes('airtable.com')) {
    return event.respondWith(fetch(req));
  }

  // For other requests:
  event.respondWith(
    caches.match(req).then(cached => {
      // Cache-first for static assets
      return (
        cached ||
        fetch(req).then(response => {
          // Only cache safe GET responses
          if (req.method === 'GET' && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(req, response.clone());
            });
          }
          return response;
        })
      );
    })
  );
});
