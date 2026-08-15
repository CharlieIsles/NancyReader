const CACHE = 'reading-tracker-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for app code so a fresh deploy is picked up on next load;
// falls back to cache when offline. Cache is still primed on install for
// the offline case, and kept fresh here on every successful fetch.
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  if(!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request).then(res => {
      if(res.ok){
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
