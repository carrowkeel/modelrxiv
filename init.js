'use strict';

const initServiceWorker = (uri) => new Promise((resolve, reject) => {
	if ('serviceWorker' in navigator) {
		return navigator.serviceWorker.register(uri, {scope: '/'}).then(reg => {
			if (!reg.waiting && !reg.active) {
				reg.addEventListener('updatefound', () => {
					reg.installing.addEventListener('statechange', e => {
						if (e.target.state === "activated") {
							resolve();
						}
					});
				});
			} else
				resolve();
		}).catch(e => {
			console.log('Failed to register sw.js: ' + e);
			reject();
		});
	} else
		return reject();
});


const init = async () => {
	await initServiceWorker('/sw.js');
	import('./modelrxiv.js').then(module => module.modelrxiv());
};

window.addEventListener('load', () => {
	if (window.location.origin.match('www.modelrxiv.org'))
		return window.location.href = 'https://modelrxiv.org';
	init();
});
