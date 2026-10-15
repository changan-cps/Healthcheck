// Minimal service worker so Chrome/Edge offer "Install app". Network-only: the audit app itself is served by Apps Script.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});
