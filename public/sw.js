// ==============================================================================
// NEXTEХ PWA — SERVICE WORKER
// ==============================================================================

const CACHE_NAME = "nextex-pwa-v1";
const STATIC_ASSETS = ["/", "/icon.svg", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Excluir de caché llamadas de API, SSE de chat, Supabase y autenticación
  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api") ||
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/auth")
  ) {
    return;
  }

  // Recursos estáticos (_next/static, fuentes, iconos)
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Navegación: Network-First con fallback a caché
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
