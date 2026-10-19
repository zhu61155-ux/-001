/**
 * sw.js — Service Worker：缓存应用外壳，实现离线使用与 PWA 安装
 * 策略：缓存优先（cache-first），首次访问后即可离线打开。
 */
const CACHE = "course-schedule-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/parser.js",
  "./js/model.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/app.js",
  "./vendor/xlsx.full.min.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 只缓存同源资源
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      });
    })
  );
});
