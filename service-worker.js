"use strict";

const CACHE_NAME = "grind-psd-pwa-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/app.js",
  "./assets/styles.css",
  "./assets/icon.svg",
  "./data/database.json",
  "./data/standard.json",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (url.pathname.endsWith("/data/database.json") || url.pathname.endsWith("/data/standard.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(stripSearch(request), response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(stripSearch(request)) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackPath) return cache.match(fallbackPath);
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(stripSearch(request)) || await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(stripSearch(request), response.clone());
  return response;
}

function stripSearch(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.toString();
}
