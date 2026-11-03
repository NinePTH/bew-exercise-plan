// Offline support. Bump CACHE when the precache list changes.
const CACHE = 'hg-v2';
const PRECACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];
// Third-party assets the page needs to look right. They are fetched at install (best effort),
// and refreshed whenever the page requests them. Font files (fonts.gstatic.com) are cached the
// first time a controlled page loads them, so the very first visit may still need the network for fonts.
const CDN_PRECACHE = [
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap',
    'https://unpkg.com/@phosphor-icons/web'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

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

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    const sameOrigin = url.origin === self.location.origin;
    if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

    // Pages: network first so updates show up, cached copy when offline.
    if (req.mode === 'navigate') {
        // cache: 'no-cache' revalidates with the server, so a fresh deploy shows up straight away
        // instead of after the browser's HTTP cache expires.
        let saved = Promise.resolve();
        const network = fetch(req, { cache: 'no-cache' }).then(res => {
            // Only a real page may replace the offline copy, never a 404 or error page.
            // Clone before handing the response to the page, which consumes its body.
            if (res.ok) {
                const copy = res.clone();
                saved = caches.open(CACHE).then(c => c.put('./index.html', copy));
            }
            return res;
        });
        event.respondWith(network.catch(() => caches.match('./index.html')));
        event.waitUntil(network.then(() => saved).catch(() => {}));
        return;
    }

    // Everything else: serve from cache, refresh it in the background.
    const refresh = caches.open(CACHE).then(cache =>
        fetch(req).then(res => {
            if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res);
            return res;
        })
    );
    event.respondWith(
        caches.match(req).then(cached => cached || refresh)
    );
    event.waitUntil(refresh.catch(() => {}));
});
