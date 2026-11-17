/* Service worker: membuat aplikasi bisa dibuka tanpa internet.
   Ubah angka VERSI setiap kali Anda mengganti file aplikasi. */
const VERSI = 'laundry-v2.1.0';
const ASET = ['./', 'index.html', 'css/style.css', 'js/app.js', 'data/config.json',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => c.addAll(ASET)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Jaringan dulu (supaya pembaruan dari GitHub langsung terpakai), cache sebagai cadangan saat offline.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(VERSI).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html')))
  );
});
