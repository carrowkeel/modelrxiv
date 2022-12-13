'use strict';

const loadScript = (script, type="script") => new Promise(resolve => {
	if (document.head.querySelectorAll(`script[src="${script}"]`).length > 0)
		return resolve();
	const elem = document.createElement(type);
	type === 'link' ? elem.href = script : elem.src = script;
	elem.addEventListener('load', () => resolve());
	document.head.appendChild(elem);
});

const parseJSON = (text, default_value={}) => {
	try {
		if (text === null)
			throw 'JSON string missing';
		return JSON.parse(text);
	} catch (e) {
		return default_value;
	}
};

const getCredentials = (type) => { // Add same or combined for setting credentials
	if (!type)
		return ['user_id', 'token', 'cdn'].reduce((credentials, key) => Object.assign(credentials, {[key]: getCredentials(key)}), {});
	switch(type) {
		case 'user_id':
			return localStorage.getItem('mdx_user') || false;
		case 'token':
			return localStorage.getItem('mdx_token') || false;
		case 'cdn':
			return parseJSON(localStorage.getItem('mdx_signature'), false);
	}
};

const signedURL = (url, query = {}) => {
	const signature = getCredentials('cdn');
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

const addModule = (elem, name, options={}, replace_element=false) => new Promise((resolve, reject) => {
	const module = replace_element ? elem : elem.appendChild(document.createElement('div'));
	module.dataset.module = name;
	Object.keys(options).forEach(k => typeof options[k] !== 'object' ? module.dataset[k] = options[k] : 0);
	module.dispatchEvent(new CustomEvent('render', {detail: {options}}));
	module.addEventListener('done', e => {
		resolve({module, data: e.detail});
	});
});

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
