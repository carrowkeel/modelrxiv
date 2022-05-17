'use strict';

const cache_id = 'mdx_cache';
const mdx_origin = 'https://modelrxiv.org';

const cacheResponse = (request, response) => {
	return caches.open(cache_id).then(async cache => {
		if (request.method !== 'POST' && request.method !== 'PUT' && ![206, 416].includes(response.status))
			await cache.put(request, response.clone());
		return response;
	});
};

const routeRequest = async (request) => {
	const url = new URL(request.url);
	if (url.origin === mdx_origin && url.pathname.startsWith('/images/')) {
		const response = await fetch(request);
		return cacheResponse(request, response);
	} else
		return fetch(request);
};

self.addEventListener('activate', event => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
	event.respondWith(caches.open(cache_id).then(cache => cache.match(event.request).then(response => {
		return response || routeRequest(event.request);
	})));
});
