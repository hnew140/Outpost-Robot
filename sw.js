/* Service worker : l'application fonctionne sans réseau, et les tuiles de
 * carte téléchargées sont servies depuis le stockage du téléphone. */
const APP_CACHE = 'balise-app-v1';
const TILE_CACHE = 'balise-tiles-v1';
const APP_FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/geo.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
];
const TILE_HOSTS = ['data.geopf.fr', 'a.tile.opentopomap.org', 'tile.openstreetmap.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('balise-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles : d'abord le stockage local, sinon le réseau.
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req.url, { ignoreVary: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        return new Response('', { status: 504, statusText: 'hors-ligne' });
      }
    })());
    return;
  }

  // Fichiers de l'application : réseau d'abord (pour les mises à jour), stockage local en secours.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        // Délai court : en montagne, un réseau faible ne doit pas bloquer l'ouverture.
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('index.html');
        throw err;
      }
    })());
  }
});
