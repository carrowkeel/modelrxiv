'use strict';

const numericize = v => Array.isArray(v) ? v.map(numericize) : typeof v === 'object' ? Object.keys(v).reduce((a,_v)=>Object.assign(a, {[_v]: numericize(v[_v])}), {}) : (v !== '' && v !== null && !isNaN(v) ? +(v) : v);

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

const readForm = (form, defaults = {}) => {
	if (!form)
		return defaults;
	const args = {};
	Array.from(form.querySelectorAll('[name]:not(.range)')).filter(item => item.closest('.form, .entry') === form).forEach(item => {
		const name = item.getAttribute('name');
		if (item.getAttribute('type') === 'checkbox')
			return item.checked ? Object.assign(args, {[name]: args[name] ? args[name].concat(item.value) : [item.value]}) : 0;
		switch(item.dataset.type) {
			case 'json':
				Object.assign(args, {[name]: JSON.parse(item.value)});
				break;
			case 'vector':
				Object.assign(args, {[name]: item.value.split(',').map(v => +(v))});
				break;
			default:
				Object.assign(args, {[name]: item.value});
		}
	});
	Array.from(form.querySelectorAll('[data-entry]')).filter(item => item.parentElement.closest('.form, .entry') === form).forEach(entry => {
		const name = entry.dataset.entry;
		const data = readForm(entry);
		if (data.name)
			Object.assign(args, {[name]: args[name] ? args[name].concat(data) : [data]});
	});
	return Object.assign(defaults, args);
};


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
	try {
		await initServiceWorker('/sw.js');
	} catch (e) {
		console.log('Failed to load Service Worker');
	}
	import('./modelrxiv.js').then(module => module.modelrxiv());
};

window.addEventListener('load', () => {
	if (window.location.origin.match('www.modelrxiv.org'))
		return window.location.href = 'https://modelrxiv.org';
	init();
});
