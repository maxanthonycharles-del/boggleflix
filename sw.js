/* ================================================================
   Boggleflix Party — offline support.

   The whole game is one self-contained file: fonts, dictionary, sounds and
   code are all inline, and nothing is fetched at runtime except the two MQTT
   brokers (party mode) and version.txt (the update check). So Solo Practice
   and the Daily Puzzle need no network at all — they only need the page
   itself to load. That is all this does: keep a copy of the page so it opens
   with no signal.

   NETWORK FIRST, deliberately. A cache-first worker would pin whatever
   version a phone happened to install and keep serving it for weeks, which is
   the exact failure we have already been fighting with a stale host. Online,
   every load goes to the network and the cache is only refreshed; the copy is
   used when the network fails. version.txt is never cached, or the update
   prompt would be lying.
   ================================================================ */
const BUILD = '37603184b92e';
const CACHE = 'boggleflix-' + BUILD;
const PAGE = './';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(PAGE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // brokers etc: not ours
  if (url.pathname.endsWith('version.txt')) return;        // must always be live

  // Navigations (and the page itself): fresh when we can, the copy when we can't.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(PAGE, copy)); }
          return res;
        })
        .catch(() => caches.match(PAGE, {ignoreSearch: true}).then(r => r || Response.error()))
    );
    return;
  }

  // Everything else (icons, the manifest): the copy first, it never changes
  // within a build, then the network.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
