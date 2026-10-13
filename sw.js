// ── Secretary: Progressive Web App Service Worker ──
// Provides installability criteria, background caching of shell assets, and transparent network bypass for E2EE cloud sync & AI APIs.

const CACHE_NAME = 'secretary-pwa-v4.0.33';

const PRECACHE_ASSETS = [
  './',
  './app.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './css/app-base.css',
  './css/app-board.css',
  './css/app-focus.css',
  './css/app-todos.css',
  './css/app-editor.css',
  './css/app-misc.css',
  './css/app-planner.css',
  './css/app-collab.css',
  './css/app-omnibar.css',
  './css/app-dailyreview.css',
  './css/app-tutorial.css',
  './css/app-chat.css',
  './js/translations.js',
  './js/app-utils.js',
  './js/app-bridge.js',
  './js/app-pwa.js',
  './js/vendor/turndown.js',
  './js/vendor/turndown-plugin-gfm.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use cache.addAll with individual catch so missing optional assets don't fail installation
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[Secretary SW] Precache skipped for:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('secretary-pwa-')) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Only process GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Bypass external APIs (Firebase, Google, OpenAI, Anthropic, Gemini, Groq, local Ollama)
  const isApiOrCloud = (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('openai') ||
    url.hostname.includes('anthropic') ||
    url.hostname.includes('groq') ||
    url.hostname.includes('ollama') ||
    url.port === '11434' ||
    url.pathname.startsWith('/api/')
  );

  if (isApiOrCloud) {
    return;
  }

  // 3. Navigation requests (HTML documents): Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => cached || caches.match('./app.html'));
        })
    );
    return;
  }

  // 4. Same-origin static assets: Network-first with stale-while-revalidate fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // 5. CDN static assets (KaTeX, Marked): Cache-first fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
