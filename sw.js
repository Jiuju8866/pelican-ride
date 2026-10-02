// 鹈鹕骑行 service worker: cache the whole (tiny) game so it runs offline.
// All paths are relative to this file, so it works at any sub-path (e.g. GitHub Pages /pelican-ride/).
const CACHE = 'pelican-ride-v6';
const ASSETS = ['./', 'index.html', 'game.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pelican-ride-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// cache first (instant + offline), then refresh the cached copy in the background
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(cache => cache.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => hit || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })));
});
