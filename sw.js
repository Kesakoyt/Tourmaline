/* ==========================================================================
   Tourmaline — Service worker
   Stratégies :
     - Interface (HTML, CSS, JS, images locales) : cache-first
     - Icônes Icons8                                             : cache-first
     - Actualités / API / proxys RSS                             : network-first
   ========================================================================== */

const VERSION = "1.1.3";
const CACHE_APP = `tourmaline-app-v${VERSION}`;
const CACHE_MEDIA = `tourmaline-media-v${VERSION}`;
const CACHE_NEWS = `tourmaline-news-v${VERSION}`;

const BASE_URL = new URL("./", self.location.href);

const APP_SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/news-service.js",
  "js/ai-summarizer.js",
  "js/firebase-service.js",
  "js/firebase-config.js",
  "manifest.json",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/icons/source-diamond.png",
  "assets/news/archive.jpg",
  "assets/news/city.jpg",
  "assets/news/climate.jpg",
  "assets/news/economy.jpg",
  "assets/news/newspapers.jpg",
  "assets/news/ocean.jpg",
  "assets/news/parliament.jpg",
  "assets/news/technology.jpg"
].map((path) => new URL(path, BASE_URL).href);

const NEWS_HOSTS = [
  "api.rss2json.com",
  "newsapi.org",
  "gnews.io",
  "proxy.corsfix.com",
  "api.allorigins.win",
  "api.codetabs.com",
  "feeds.bbci.co.uk",
  "www.lemonde.fr",
  "www.lefigaro.fr",
  "www.francetvinfo.fr",
  "www.france24.com",
  "www.lexpress.fr",
  "www.mediapart.fr",
  "www.theguardian.com",
  "www.propublica.org",
  "www.aljazeera.com",
  "www.revolutionpermanente.fr"
];

const ICONS_HOST = "img.icons8.com";

function isNewsRequest(url) {
  return NEWS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![CACHE_APP, CACHE_MEDIA, CACHE_NEWS].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await networkFirst(request, CACHE_APP);
      } catch {
        const cache = await caches.open(CACHE_APP);
        return (await cache.match(new URL("index.html", BASE_URL).href))
          || (await cache.match(new URL("./", BASE_URL).href))
          || new Response(
            "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><title>Hors ligne</title><body style=\"font-family:Segoe UI,sans-serif;padding:40px;background:#f3f3f3;color:#1a1a1a\"><h1>Tourmaline est hors ligne</h1><p>Reconnectez-vous pour actualiser l'actualité.</p></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
      }
    })());
    return;
  }

  if (url.hostname === ICONS_HOST || url.hostname.endsWith(`.${ICONS_HOST}`)) {
    event.respondWith(cacheFirst(request, CACHE_MEDIA).catch(() => new Response("", { status: 504 })));
    return;
  }

  if (isNewsRequest(url)) {
    event.respondWith(networkFirst(request, CACHE_NEWS));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_APP).catch(() => new Response("", { status: 504 })));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
