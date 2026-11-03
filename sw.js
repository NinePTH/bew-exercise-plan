// Offline support. Bump CACHE when the precache list changes.
const CACHE = 'hg-v3';
const PRECACHE = [
    './',
    './index.html',
    './styles.css',
    './manifest.webmanifest',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];
// Third-party assets (font and icons). They are fetched at install (best effort) and refreshed
// whenever the page requests them. Font files (fonts.gstatic.com) are cached the first time a
// controlled page loads them, so the very first visit may still need the network for fonts.
const CDN_PRECACHE = [
    'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap',
    'https://unpkg.com/@phosphor-icons/web'
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(async cache => {
            await cache.addAll(PRECACHE);
            // no-cors gives opaque responses; fine for <script>/<link>. A failure here must not block install.
            await Promise.all(CDN_PRECACHE.map(u =>
                fetch(u, { mode: 'no-cors' }).then(res => cache.put(u, res)).catch(() => {})));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network first, cached copy when offline. Only successful responses replace the cached copy.
// `cacheKey` lets every page navigation share the one offline copy of index.html.
function networkFirst(event, cacheKey) {
    let saved = Promise.resolve();
    // cache: 'no-cache' revalidates with the server, so a fresh deploy shows up straight away
    // instead of after the browser's HTTP cache expires.
    const network = fetch(event.request, { cache: 'no-cache' }).then(res => {
        if (res.ok) {
            const copy = res.clone(); // clone before the page consumes the body
            saved = caches.open(CACHE).then(c => c.put(cacheKey, copy));
        }
        return res;
    });
    event.respondWith(network.catch(() => caches.match(cacheKey)));
    event.waitUntil(network.then(() => saved).catch(() => {}));
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        // The app's own files change together on each deploy, so always prefer the network:
        // a cached stylesheet must never be paired with a newer page.
        networkFirst(event, req.mode === 'navigate' ? './index.html' : req);
        return;
    }
    if (!CDN_HOSTS.includes(url.hostname)) return;

    // Font and icon CDNs: serve from cache, refresh it in the background.
    const refresh = caches.open(CACHE).then(cache =>
        fetch(req).then(res => {
            if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res);
            return res;
        })
    );
    event.respondWith(caches.match(req).then(cached => cached || refresh));
    event.waitUntil(refresh.catch(() => {}));
});
