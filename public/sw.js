const CACHE_NAME = 'apex-v1';

// On install, claim all clients immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// On every fetch, check for version update
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Check if HTML document contains a new app-version meta tag
        if (event.request.destination === 'document' || event.request.url.endsWith('/')) {
          response.clone().text().then((html) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newVersion = doc.querySelector('meta[name="app-version"]')?.content;

            if (newVersion && newVersion !== localStorage.getItem('app-version')) {
              localStorage.setItem('updateAvailable', 'true');
              localStorage.setItem('app-version', newVersion);
              // Notify all clients that update is available
              clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                  client.postMessage({ type: 'UPDATE_AVAILABLE' });
                });
              });
            }
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
