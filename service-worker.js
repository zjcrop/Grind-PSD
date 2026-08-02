"use strict";

const SHELL_CACHE = "grind-psd-shell-v1.5.0";
const DATA_CACHE = "grind-psd-data-v1.5.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/psd-core.js",
  "./assets/supabase-sync-v7.2.2.js",
  "./assets/app-v7.js",
  "./assets/record-policy-core-v1.4.js",
  "./assets/record-policy-core-v1.4-base.js",
  "./assets/pair-compare-v1.5.js",
  "./assets/permissions-v1.4.js",
  "./assets/styles-v5.css",
  "./assets/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./manifest.webmanifest",
  "./data/standard.json",
  "./data/record.schema.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const current = new Set([SHELL_CACHE, DATA_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !current.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "./index.html"));
    return;
  }

  if (
    url.pathname.endsWith("/data/database.json") ||
    url.pathname.includes("/data/users/")
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (
    url.pathname.endsWith("/assets/app-v7.js") ||
    url.pathname.endsWith("/assets/record-policy-core-v1.4.js") ||
    url.pathname.endsWith("/assets/record-policy-core-v1.4-base.js") ||
    url.pathname.endsWith("/assets/pair-compare-v1.5.js") ||
    url.pathname.endsWith("/assets/permissions-v1.4.js") ||
    url.pathname.endsWith("/assets/supabase-sync-v7.2.2.js") ||
    url.pathname.endsWith("/assets/psd-core.js") ||
    url.pathname.endsWith("/assets/styles-v5.css") ||
    url.pathname.endsWith("/data/app-config.json") ||
    url.pathname.endsWith("/manifest.webmanifest")
  ) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request, cacheName, fallbackPath = "") {
  const cache = await caches.open(cacheName);
  const key = stripSearch(request);
  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = stripSearch(request);
  const cached = await cache.match(key) || await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  }).catch(() => null);
  return cached || network || Response.error();
}

function stripSearch(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.toString();
}
