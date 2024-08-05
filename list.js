import { readForm } from '/apc/form.js';

const hooks = [
	['*', 'auth', e => {
		document.querySelector('.filtered-list').dispatchEvent(new Event('refresh'));
	}],
	['.menu a[href]', 'click', e => {
		e.target.closest('.menu').classList.remove('show');
	}],
	['.profile-icon', 'click', e => {
		const nav = e.target.closest('nav');
		nav.querySelector('.profile-menu').classList.toggle('show');
	}],
	['.filtered-list', 'refresh', e => {
		updateList(e.target);
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

const filterModels = (models, query) => {
	return models
		.filter(model => {
			if (query.search && !model.title.match(new RegExp(query.search, 'i')) && !model.description.match(new RegExp(query.search, 'i')))
				return false;
			for (const prop in query) {
				if (['order', 'search'].includes(prop))
					continue;
				if (Array.isArray(query[prop])) {
					const cond = query[prop].map(value => value.split(',')).flat();
					if (!cond.includes(model[prop]))
						return false;
				} else if (query[prop] !== model[prop])
					return false;
			}
			return true;
		})
		.sort((a,b) => typeof a[query.order || 'title'] === 'string' ? a[query.order || 'title'].localeCompare(b[query.order || 'title']) : b[query.order] - a[query.order]);
};

const updateList = async (container) => {
	const query = readForm(container.querySelector('.filters'));
	const models = await Promise.all([
		await fetch('/models/list.json').then(res => res.json()).then(entries => entries.map(entry => Object.assign(entry, {visibility: 'public'}))),
		await fetch('/user/list.json').then(res => res.json()).catch(() => []).then(entries => entries.map(entry => Object.assign(entry, {visibility: 'sandbox'}))).catch(e => [])
	]).then(lists => lists.flat());
	const filtered = filterModels(models, query);
	for (const counter of Array.from(container.querySelectorAll('.filters [data-count]'))) {
		if (counter.dataset.count === '') {
			counter.innerText = filtered.length;
			continue;
		}
		const term = counter.dataset.count.split(':');
		counter.innerText = filterModels(models, Object.assign({}, query, {[term[0]]: [term[1]]})).length;
	}
	container.querySelector('.model-list').innerHTML = filtered.map(model => `<div data-type="${model.visibility} ${model.type || model.publication_status || 'published'}"><div class="details"><div class="fright"><a data-category="${model.type || model.publication_status || 'published'}">${model.type || model.publication_status || 'published'}</a></div><h3><a href="/${model.visibility === 'public' ? 'model' : 'sandbox'}/${model.model_id}" class="title">${model.title || 'Untitled model'}</a></h3><h4>${typeof model.authors === 'string' ? model.authors : `${model.authors[0]}${model.authors.length > 2 ? ` <a title="${model.authors.slice(1).join(', ')}">[...]</a>` : ''}`}</h4>${model.tags ? `<p>${model.tags.map(v => `<a href="/tag/${v}" data-tag="${v}">#${v}</a>`).join('')}</p>` : ''}</div></div>`).join('');
};

export const init = async (container) => {
	addHooks(window, hooks);
	updateList(container);
};
