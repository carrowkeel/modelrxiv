'use strict';

const queryFromPath = (path, defaults = {}) => numericize(path.substring(1).split('/').reduce((a,v,i,arr)=>i%2===0&&arr[i+1]!==undefined?Object.assign(a, {[v]: arr[i+1]}):a, defaults));

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
		e.target.innerHTML = `<a class="profile-icon" data-icon="E"></a><div class="profile-menu user-menu menu"><a class="item" href="/submit">Upload model</a><div class="state-change"><a data-action="logout">Logout</a></div></div>`;
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
	['.login-form input', 'keydown', e => {
		if (e.keyCode === 13) {
			const args = readForm(e.target.closest('.form'));
			auth(env, args);
		}
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
	}],
	['.toolbar, .toolbar *', 'dragover', e => {
		const toolbar = e.target.closest('.toolbar');
		e.preventDefault();
		toolbar.classList.add('dragover');
	}],
	['.toolbar, .toolbar *', 'dragleave', e => {
		const toolbar = e.target.closest('.toolbar');
		toolbar.classList.remove('dragover');
	}],
	['.toolbar, .toolbar *', 'drop', e => {
		const toolbar = e.target.closest('.toolbar');
		e.preventDefault();
		const dragged = document.querySelector('.plot.dragged');
		const group = document.createElement('div');
		group.classList.add('group');
		const clone = dragged.cloneNode(true);
		group.appendChild(clone);
		toolbar.appendChild(group);
		toolbar.classList.remove('dragover');
		dragged.classList.remove('dragged');
		clone.classList.remove('dragged');
	}]
];

// TODO: restructure this function
const navigate = async (env, url, back=false, reload=false) => {
	for (const slug in env.processes) {
		clearTimeout(env.processes[slug].timeout);
		delete env.processes[slug];
	}
	const uri = url || window.location.pathname;
	const query = queryFromPath(uri);
	const pagename = uri.substring(1);
	const main_elem = document.querySelector('.main');
	const static_pages = {login: 'Login', register: 'Register', privacy: 'Privacy', terms: 'Terms', contribute: 'Contribute'}; // Remove using cloudfront origin function or similar solution
	switch(true) {
		case static_pages[pagename] !== undefined:
			fetch(`/pages/${pagename}`).then(res => res.text()).then(html => {
				document.title = `${static_pages[pagename]} | modelRxiv`;
				main_elem.innerHTML = `<div class="page">${html}</div>`;
			});
			break;
		case pagename === 'submit' || (query.edit && getCredentials('user_id') !== false): {
			main_elem.innerHTML = '';
			const entry = query.edit ? await env.db.get(signedURL(`users/${getCredentials('user_id')}/.list`), ['model_id', query.edit]) : false;
			const data = entry ? await env.db.get(signedURL(`users/${getCredentials('user_id')}/${entry.model_id}.json`), [], {private: true}) : false; // This repeats below
			await addModule(main_elem, 'submit', {entry: data, query});
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
				await addModule(main_elem, 'model', {entry: data, query});
			} else
				return navigate(env, '/');
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
	if (!reload) {
		if (back)
			window.history.replaceState({page: url}, '', url);
		else
			window.history.pushState({page: url}, '', url);
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
		} else {
			throw 'Authentication failed';
		}
	}).catch(e => {
		document.querySelector('.mdx-auth').dispatchEvent(new CustomEvent('loggedout', {detail: {login: login.user_name !== undefined}}));
		document.querySelectorAll('.login-form .error').forEach(item => item.innerHTML = 'Login details incorrect');
		console.log(e);
	});
};

export const modelrxiv = async () => {
	const env = {db: staticDB({uri: 'https://mdx1.modelrxiv.org'}), processes: {}, timeouts: {}};
	addHooks(window, hooks(env));
	await auth(env);
	addModule(document.querySelector('.apocentric'), 'apc', {options: {getCredentials, worker_script: '/worker.js', url: 'wss://apc.modelrxiv.org', threads: navigator.hardwareConcurrency, frameworks: ['js', 'py']}}, true);
	window.addEventListener('popstate', e => {
		if (e.state.page)
			navigate(env, e.state.page, true);
	});
	navigate(env, undefined, false, true);
};
