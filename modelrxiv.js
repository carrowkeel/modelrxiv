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
			throw 'JSON string missing'; // For cases where null is returned such as localStorage
		return JSON.parse(text);
	} catch (e) {
		return default_value;
	}
};

const queryFromPath = (defaults = {}) => numericize(window.location.pathname.substring(1).split('/').reduce((a,v,i,arr)=>i%2===0&&arr[i+1]!==undefined?Object.assign(a, {[v]: arr[i+1]}):a, defaults));

const addModule = (elem, name, options={}) => new Promise((resolve, reject) => {
	const module = elem.appendChild(document.createElement('div'));
	module.dataset.module = name;
	Object.keys(options).forEach(k => typeof options[k] !== 'object' ? module.dataset[k] = options[k] : 0);
	module.dispatchEvent(new CustomEvent('render', {detail: {options}}));
	module.addEventListener('done', e => {
		resolve({module, data: e.detail});
	});
});

const staticDB = options => ({
	data: {},
	load: async function (entry, reload=false) {
		if (this.data[entry] !== undefined && !reload)
			return this.data[entry];
		return fetch(`${options.uri}/${entry}`, {cache: 'reload'}).then(res => {
			return res.ok ? res.json() : [];
		}).then(json => {
			this.data[entry] = json;
			return this.data[entry];
		});
	},
	purge: function (entries=Object.keys(this.data)) {
		for (const entry of entries)
			delete this.data[entry];
	},
	list: function (entry, filter, reload=false) {
		return this.load(entry, reload).then(data => filter ? data.filter(v => v[filter[0]] === filter[1]) : data);
	},
	col: function (entry, col, reload=false) {
		return this.load(entry, reload).then(data => data.map(v => v[col]));
	},
	get: async function (entry, filter, flag={}, reload=false) {
		return this.load(entry, reload).then(data => {
			const item = data instanceof Array ? data.find(v => v[filter[0]] === filter[1]) : data;
			return item ? Object.assign({}, item, flag) : false;
		});
	}
});

const signedURL = (url, query = {}) => {
	const signature = getCredentials('cdn');
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

const addHooks = (elem, hooks) => {
	for (const type of Object.keys(hooks.reduce((a,v)=>Object.assign(a, {[v[1]]: 1}), {}))) {
		elem.addEventListener(type, e => {
			for (const hook of hooks.filter(v=>v[1]===type)) {
				if (e.target.matches(hook[0]))
					hook[2](e);
			}
		}, true);
	}
};

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

const filterModels = (models, query) => {
	return models
		.filter(model => {
			if (query.search && !model.title.match(new RegExp(query.search, 'i')) && !model.description.match(new RegExp(query.search, 'i')))
				return false;
			for (const prop in query) {
				if (['order', 'search'].includes(prop))
					continue;
				if (Array.isArray(query[prop])) {
					if (!query[prop].includes(model[prop]))
						return false;
				} else if (query[prop] !== model[prop])
					return false;
			}
			return true;
		})
		.sort((a,b) => typeof a[query.order || 'title'] === 'string' ? a[query.order || 'title'].localeCompare(b[query.order || 'title']) : b[query.order] - a[query.order]);
};

const updateList = async (env, container) => {
	const query = readForm(container.querySelector('.filters'));
	const models = await Promise.all([env.db.list('models/.list').then(list => list.map(v => Object.assign(v, {visibility: 'public', type: v.type ? v.type : 'published'}))), getCredentials('user_id') 
? env.db.list(signedURL(`users/${getCredentials('user_id')}/.list`)).then(list => list.map(v => Object.assign(v, {private: true, visibility: 'private'}))) : []]).then(lists => lists.reduce((a,list) => a.concat(list), []));
	const filtered = filterModels(models, query);
	for (const counter of Array.from(container.querySelectorAll('.filters [data-count]'))) {
		if (counter.dataset.count === '') {
			counter.innerText = filtered.length;
			continue;
		}
		const term = counter.dataset.count.split(':');
		counter.innerText = filterModels(models, Object.assign({}, query, {[term[0]]: [term[1]]})).length; // TODO: case for non checkbox filters
	}
	container.querySelector('.model-list').innerHTML = '';
	for (const model of filtered)
		await addModule(container.querySelector('.model-list'), 'model', {entry: Object.assign({}, model, {preview: true})});
};

const hooks = env => [
	['[data-module]', 'render', async e => {
		const module_name = e.target.dataset.module;
		const options = e.detail.options || Object.assign({}, e.target.dataset);
		const module = (await import(`./${module_name}.js`))[module_name](env, options, e.target);
		addHooks(e.target, module.hooks);
		return module.render();
	}],
	['[data-module]', 'done', e => {
		// Temp, this can include any transformation of html after the module has rendered
		e.target.querySelectorAll('.shorten').forEach(item => {
			const text = item.innerHTML;
			if (text.length < 200)
				return;
			const shortened = text.substring(0, 150);
			item.innerHTML = `<div class="short">${shortened}... <a data-action="more">Read more</a></div><div class="long">${text} <a data-action="more">Read less</a></div>`;
		});
	}],
	['.shorten [data-action="more"]', 'click', e => {
		e.target.closest('.shorten').classList.toggle('show');
	}],
	['.main', 'refresh', e => {
		env.db.purge(e.detail?.entries);
	}],
	['.main', 'navigate', e => {
		if (!e.detail?.url)
			return;
		navigate(env, e.detail.url);
	}],
	['.mdx-auth', 'authenticated', e => {
		e.target.innerHTML = `<a class="profile-icon" data-icon="E"></a><div class="profile-menu user-menu menu"><a class="item" href="/owner/me">Profile</a><a class="item" href="/submit">Upload model</a><div class="connect"><a data-action="logout">Logout</a></div></div>`;
	}],
	['.mdx-auth', 'loggedout', e => {
		localStorage.removeItem('mdx_token');
		localStorage.removeItem('mdx_signature');
		localStorage.removeItem('mdx_user');
		e.target.innerHTML = '<a href="/login" data-icon="l"></a>';
		if (!e.detail?.login)
			navigate(env, '/', undefined, true);
	}],
	['.register-button', 'click', e => {
		const args = readForm(e.target.closest('.form'), {action: 'register'});
		fetch('https://d.modelrxiv.org/auth', {method: 'POST', body: JSON.stringify(args)}).then(res => {
			navigate(env, '/login');
		});
	}],
	['[data-action="logout"]', 'click', e => {
		document.querySelector('.mdx-auth').dispatchEvent(new Event('loggedout'));
	}],
	['.login-button', 'click', e => {
		const args = readForm(e.target.closest('.form'));
		auth(env, args);
	}],
	['.menu a[href]', 'click', e => {
		e.target.closest('.menu').classList.remove('show');
	}],
	['a[href]', 'click', e => {
		const href = e.target.getAttribute('href');
		if (href.startsWith('/')) {
			e.preventDefault();
			e.stopPropagation();
			navigate(env, href);
		}
	}],
	['.profile-icon', 'click', e => {
		const nav = e.target.closest('nav');
		nav.querySelector('.profile-menu').classList.toggle('show');
	}],
	['.filtered-list', 'refresh', e => {
		updateList(env, e.target);
	}],
	['.filters select', 'change', e => {
		e.target.closest('.filtered-list').dispatchEvent(new Event('refresh'));
	}],
	['.filters input[type="checkbox"]', 'click', e => {
		e.target.closest('.filtered-list').dispatchEvent(new Event('refresh'));
	}],
	['.filters input[type="text"]', 'keyup', e => {
		if (e.keyCode !== 13)
			return;
		e.target.closest('.filtered-list').dispatchEvent(new Event('refresh'));
	}]
];

// TODO: restructure this function
const navigate = async (env, url, back=false, reload=false) => {
	if (!reload) {
		if (back)
			window.history.replaceState({page: url}, '', url);
		else
			window.history.pushState({page: url}, '', url);
	}
	for (const slug in env.processes) {
		clearTimeout(env.processes[slug].timeout);
		delete env.processes[slug];
	}
	const query = queryFromPath();
	const pagename = window.location.pathname.substring(1);
	const main_elem = document.querySelector('.main');
	switch(true) {
		case env.static_pages[pagename] !== undefined:
			fetch(`/pages/${pagename}`).then(res => res.text()).then(html => {
				document.title = `${env.static_pages[pagename]} | modelRxiv`;
				main_elem.innerHTML = `<div class="page">${html}</div>`;
			});
			break;
		case pagename === 'submit' || (query.edit && getCredentials('user_id') !== false): {
			main_elem.innerHTML = '';
			const entry = query.edit ? await env.db.get(signedURL(`users/${getCredentials('user_id')}/.list`), ['model_id', query.edit]) : false;
			const data = entry ? await env.db.get(signedURL(`users/${getCredentials('user_id')}/${entry.model_id}.json`), [], {private: true}) : false; // This repeats below
			addModule(main_elem, 'submit', {entry: data, query});
			break;
		}
		case query.model !== undefined || (query.sandbox !== undefined && getCredentials('user_id') !== false): {
			main_elem.innerHTML = '';
			const entry = await env.db.get(query.sandbox ? signedURL(`users/${getCredentials('user_id')}/.list`) : 'models/.list', ['model_id', query.model || query.sandbox]);
			if (entry) {
				document.title = `${entry.title || 'Untitled model'} | modelRxiv`;
				const data = await (query.sandbox ?
					env.db.get(signedURL(`users/${getCredentials('user_id')}/${entry.model_id}.json`), [], {private: true}) :
					env.db.get(`models/${query.model}.json`));
				addModule(main_elem, 'model', {entry: data, query});
			} else
				navigate(env, '/');
			break;
		}
		default:
			await fetch('/pages/index').then(res => res.text()).then(html => {
				document.title = 'modelRxiv';
				main_elem.innerHTML = `<div class="page">${html}</div>`;
			});
			Object.entries(query).forEach(([name, value]) => main_elem.querySelectorAll(`.filters [name="${name}"]`).forEach(item => item.value = value)); // Maybe move elsewhere
			main_elem.querySelector('.filtered-list').dispatchEvent(new Event('refresh'));
	}
};

const auth = (env, login={}) => {
	const token = getCredentials('token');
	if (!token && login.user_name === undefined)
		return false;
	return fetch('https://d.modelrxiv.org/auth', {method: 'POST', body: JSON.stringify(login.user_name ? {action: 'login', ...login} : {action: 'verify', jwt: token})}).then(async res => {
		if (res.ok) {
			const auth_data = await res.json();
			if (auth_data.data?.token) {
				localStorage.setItem('mdx_token', auth_data.data.token);
				localStorage.setItem('mdx_user', auth_data.data.user_id);
				localStorage.setItem('mdx_signature', JSON.stringify({'Policy': auth_data.data.signed['CloudFront-Policy'], 'Key-Pair-Id': auth_data.data.signed['CloudFront-Key-Pair-Id'], 'Signature': auth_data.data.signed['CloudFront-Signature'], 'expiry': new Date().getTime() + 6 * 3600 * 1000}));
				if (login.user_name !== undefined)
					navigate(env, '/');
			}
			document.querySelector('.mdx-auth').dispatchEvent(new CustomEvent('authenticated', {detail: {token: auth_data.data?.token || token}}));
		} else
			document.querySelector('.mdx-auth').dispatchEvent(new CustomEvent('loggedout', {detail: {login: login.user_name !== undefined}}));
	}).catch(e => {
		console.log(e);
	});
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

const init = async () => {
	const env = {static_pages: {login: 'Login', register: 'Register', privacy: 'Privacy', terms: 'Terms', contribute: 'Contribute'}, db: staticDB({uri: 'https://modelrxiv.org'}), processes: {}, timeouts: {}};
	addHooks(window, hooks(env));
	await auth(env);
	import('./apc.js').then(apc => apc.init(document.querySelector('.apocentric'), {getCredentials, worker_script: '/worker.js', url: 'wss://apc.modelrxiv.org', threads: navigator.hardwareConcurrency, frameworks: ['js', 'py']}));
	window.addEventListener('popstate', e => {
		if (e.state.page)
			navigate(env, e.state.page, true);
	});
	navigate(env, undefined, false, true);
};

window.addEventListener('load', () => {
	init();
});