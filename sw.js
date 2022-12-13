'use strict';

const cache_id = 'mdx_cache';
const mdx_origin = 'https://modelrxiv.org';

const getEnv = () => {
	return caches.open(cache_id).then(async cache => {
		return cache.match(new Request('/env')).then(response => response ? response.text() : 'prod');
	});
};

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
	} else if (url.origin === mdx_origin) {
		const env_state = await getEnv();
		if (env_state === 'test')
			return fetch(new Request(`https://beta.modelrxiv.org${url.pathname}`));
		return fetch(request);
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
