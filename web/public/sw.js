const CACHE_NAME = 'zjut-grad-schedule-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg?v=4', '/icons/brand-icon.svg?v=4', '/icons/icon-180.png?v=4', '/icons/icon-192.png?v=4', '/icons/icon-512.png?v=4']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url)

  if (
    event.request.method !== 'GET'
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname === '/calendar.ics'
  ) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached
        return event.request.mode === 'navigate' ? caches.match('/') : Response.error()
      })),
  )
})
