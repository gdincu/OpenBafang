const STATIC_CACHE = 'bafang-tracker-v2';
const DYNAMIC_CACHE = 'bafang-dynamic-v2';

const ASSETS = [
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/bafang-protocol.js',
  './icon.png',
  './manifest.json'
];

// Install Event - Pre-cache core assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

// Update lifecycle listener
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate Event - Clean up stale caches
self.addEventListener('activate', (e) => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE];
  
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!currentCaches.includes(key)) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  const request = e.request;

  // 1. Ignore non-HTTP/HTTPS & non-GET requests (POST, PUT, WebSockets, Chrome Extensions)
  if (!request.url.startsWith('http') || request.method !== 'GET') return;

  // 2. Navigation requests (HTML pages): Network-First, fall back to cached index.html
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, resClone);
            });
          }
          return networkRes;
        })
        .catch(() => {
			return caches.match('./index.html').then((fallbackRes) => {
				return fallbackRes || caches.match(request);
			});
		})
    );
    return;
  }

  // 3. Static/Asset requests: Cache-First, fall back to Network
  e.respondWith(
    caches.match(request).then((cachedRes) => {
      if (cachedRes) return cachedRes;

      return fetch(request).then((networkRes) => {
        // Cache valid HTTP responses (include opaque/CORS for external CDN resources)
        if (
          !networkRes || 
          (networkRes.status !== 200 && networkRes.type !== 'opaque')
        ) {
          return networkRes;
        }

        return caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(request, networkRes.clone());
          return networkRes;
        });
      }).catch(() => {
        // Provide a valid Response fallback rather than returning undefined
        return new Response('Network error occurred', {
          status: 408,
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    })
  );
});