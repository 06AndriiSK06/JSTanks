const CACHE_NAME = "jstanks-v1";
const ASSETS = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	if (
		event.request.method !== "GET" ||
		event.request.url.includes("/api/") ||
		event.request.url.includes("/ws")
	) {
		return;
	}
	event.respondWith(
		fetch(event.request).catch(() => caches.match(event.request)),
	);
});
