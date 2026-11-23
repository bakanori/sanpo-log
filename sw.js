/* SANPO LOG — opens even without a signal.
   The page (index.html and its settings): the newest from the network, the kept copy when there is no signal
   (or no answer within 3 seconds). Its parts (css/ and js/): index.html names each by what is in it (?v=…), so a
   kept part with that name is used at once; a changed part has a new name and comes from the network (an older
   kept one only when there is no signal), and its older copies are let go.
   Map data, the library and the icons: the kept copy at once, refreshed quietly behind.
   Other sites (Firebase, Instagram, X, Google Maps) are never touched. */
const KEEP = 'sanpo-v2';
const FIRST = ['./', './index.html', './manifest.webmanifest', './data/japan.js', './lib/d3-delaunay.min.js', './icons/icon-192.png'];
const PART = /\/(css|js)\/[\w-]+\.(css|js)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(KEEP).then(async c => {
    await Promise.all(FIRST.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const page = await c.match('./index.html');   // and the parts this page asks for, at their version
    const html = page ? await page.text() : '';
    const parts = [...new Set(html.match(/(css|js)\/[\w-]+\.(css|js)\?v=[\w.-]+/g) || [])];
    await Promise.all(parts.map(u => c.add(new Request('./' + u, { cache: 'reload' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sanpo-') && k !== KEEP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const keep = (req, res) => { if (res && res.ok && res.type === 'basic') { const c = res.clone(); caches.open(KEEP).then(x => x.put(req, c)); } return res; };
const kept = req => caches.match(req, { ignoreSearch: true });
const keepPart = (req, res) => {   // keep this version of a part, let the other versions of it go
  if (res && res.ok && res.type === 'basic') {
    const c = res.clone(), path = new URL(req.url).pathname;
    caches.open(KEEP).then(async x => {
      await x.put(req, c);
      for (const k of await x.keys()) if (k.url !== req.url && new URL(k.url).pathname === path) x.delete(k);
    });
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (PART.test(u.pathname)) {   // css/ and js/: the same version is the same file
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(res => keepPart(req, res)).catch(() => kept(req).then(k => k || Response.error()))));
    return;
  }
  const app = req.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname) || /(firebase-config\.js|manifest\.webmanifest|README\.md)$/.test(u.pathname);
  if (app) {   // newest first; the kept copy when the network is gone or too slow
    e.respondWith(new Promise(done => {
      let over = false;
      const fallback = () => { if (over) return; over = true; kept(req).then(m => m ? done(m) : (req.mode === 'navigate' ? kept('./index.html').then(i => done(i || Response.error())) : done(Response.error()))); };
      const t = setTimeout(fallback, 3000);
      fetch(req).then(res => { clearTimeout(t); keep(req, res); if (!over) { over = true; done(res); } }).catch(() => { clearTimeout(t); fallback(); });
    }));
    return;
  }
  // map data, library, icons: kept copy first, refreshed behind
  e.respondWith(kept(req).then(m => {
    const net = fetch(req).then(res => keep(req, res)).catch(() => m || Response.error());
    if (m) { e.waitUntil(net.catch(() => {})); return m; }
    return net;
  }));
});
