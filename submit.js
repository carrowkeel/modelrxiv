
const parseJSON = (text, default_value={}) => {
	try {
		return JSON.parse(text);
	} catch (e) {
		return default_value;
	}
};
const entries = input => Object.entries(input instanceof Map ? Object.fromEntries(input) : input);
const keys = input => Object.keys(input instanceof Map ? Object.fromEntries(input) : input);

const pubmedSearch = (query, limit = 5) => {
	const params = new URLSearchParams({term: query, db: 'pubmed', retmode: 'json', retmax: limit});
	return fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`)
		.catch(e => console.log(e))
		.then(res => res.json()).then(res => {
			if (res === null || res.esearchresult.ERROR !== undefined)
				return [];
			const uids = res.esearchresult.idlist;
			const params = new URLSearchParams({db: 'pubmed', retmode: 'json', 'id': uids.join(',')});
			return fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params.toString()}`).then(res => res.json()).then(res => {
				if (res === null || res.error !== undefined)
					return [];
				return Object.keys(res.result).filter(key => key !== 'uids').map(key => res.result[key]);
			});
		});
};

const search = async (field, query) => {
	const data = await pubmedSearch(query);
	const results = document.createElement('div');
	results.classList.add('search-results');
	results.innerHTML = data.map(item => `<div class="result"><a data-doi="${item.articleids.filter(id => id.idtype === 'doi').map(id => id.value).join(',')}" data-title="${item.title}" data-authors="${item.authors.map(author => author.name).join(', ')}" data-date="${item.pubdate}">${item.title}</a><div class="authors">${item.authors.map(author => author.name).join(', ')}</div><div class="meta"><span class="journal">${item.fulljournalname}</span> <span class="date">${item.pubdate}</span></div></div>`).join('');
	results.style.width = field.offsetWidth + 'px';
	results.style.left = field.offsetLeft + 'px';
	field.parentElement.appendChild(results);
	window.addEventListener('click', e => {
		if (!e.target.closest('.search-results'))
			results.remove();
	});
};

const composeCode = (pseudocode, params) => {
	const lines = pseudocode.split('\n');
	const output_variables = [];
	const definitions = lines.map(line => {
		if (line.startsWith('#') || line === '')
			return;
		if (line.startsWith('return ')) {
			for (const output of line.replace('return ', '').match(/[a-zA-Z][a-zA-Z0-9_-]*/g))
				output_variables.push(output);
			return;
		}
		const parts = line.split(/[ ]*=[ ]*/);
		if (parts.length === 0)
			return;
		const name = parts[0];
		const definition = parts.slice(1).join('').replace(/\^/g, '**'); // TODO: find a place for math notation standardisation
		if (!isNaN(definition) || definition.match(/^\".*?\"$/)) {
			params[name] = definition.replace(/^\"(.*?)\"$/, "$1");
			return;
		}
		const parameters = definition.match(/[a-zA-Z]+/g);
		return [name, `variables['${name}'] = ${definition.replace(/([a-zA-Z][a-zA-Z0-9_-]*)/g, "variables['$1']")};`];
	}).filter(v => v); // Temp
	if (output_variables.length === 0)
		output_variables.push(definitions[definitions.length - 1][0]);
	const code = `/* Generated by ModelRxiv, editing could affect compatibility */

export const defaults = () => ({
	${Object.entries(params).map(([name, value]) => `'${name}': ${typeof value === 'string' ? `'${value}'` : value}`).join(',\n\t')}
});

export const step = (params, _step, t) => {
	const variables = Object.assign({}, params, _step);
	${definitions.map(v => v[1]).join('\n\t')}
	return {${output_variables.map(name => `'${name}': variables['${name}']`).join(', ')}};
};

export const result = (params, steps) => {
	const variables = Object.assign({}, params, steps[steps.length - 1]);
	return {${output_variables.map(name => `'${name}': variables['${name}']`).join(', ')}};
};

export const run = (params) => {
	let prev = undefined;
	for(let t = 0;t <= params.target_steps;t++) {
		const r = step(params, prev, t);
		if (!r)
			break;
		prev = r;
	}
	return result(params, [prev]);
};
`;
	return code;
}

const cloneEntry = (container, type, entry) => {
	if (Array.from(container.querySelectorAll(`.entry[data-entry="${type}"] [name="name"]`)).filter(item => item.value === entry.name).length > 0)
		return;
	const empty = container.querySelector(`[data-entry="${type}"]:last-child`);
	const cloned = empty.cloneNode(true);
	cloned.querySelectorAll('input').forEach(item => item.value = '');
	for (const prop in entry)
		cloned.querySelector(`[name="${prop}"]`) ? cloned.querySelector(`[name="${prop}"]`).value = entry[prop] : 0;
	cloned.querySelectorAll('select').forEach(elem => elem.dispatchEvent(new Event('change')));
	empty.parentElement.insertBefore(cloned, empty);
};

const populateForm = (form, data) => {
	Object.entries(data).forEach(([name, value]) => {
		if (value instanceof Array) {
			value.forEach(entry => { // TODO: combine with cloneEntry
				if (Array.from(form.querySelectorAll(`[data-entry="${name}"] [name="name"]`)).filter(item => item.value === entry.name).length > 0)
					return;
				const empty = form.querySelector(`[data-entry="${name}"]:last-child`);
				const cloned = empty.cloneNode(true);
				cloned.querySelectorAll('input').forEach(item => item.value = '');
				empty.parentElement.insertBefore(cloned, empty);
				populateForm(cloned, entry);
			});
		} else {
			Array.from(form.querySelectorAll(`[name=${name}]`)).filter(item => item.closest('.form, .entry') === form).forEach(item => {
				item.value = value;
				if (item.matches('select'))
					item.dispatchEvent(new Event('change'));
			});
		}
	});
};

const hooks = (env, entry, query, elem) => [
	['[data-module="submit"]', 'update', e => {
		const data = readForm(elem.querySelector('.submission-form'));
		const previous = parseJSON(localStorage.getItem('mdx_submit_form'), {}) || {};
		const changed = Object.keys(data).filter(key => JSON.stringify(data[key]) !== JSON.stringify(previous[key]));
		const previous_changed = parseJSON(localStorage.getItem('mdx_submit_changes'), []) || [];
		localStorage.setItem('mdx_submit_form', JSON.stringify(data));
		localStorage.setItem('mdx_submit_changes', JSON.stringify(Array.from(previous_changed.concat(changed))));
	}],
	['[data-module="submit"]', 'init', async e => {
		if (entry) {
			const module_url = signedURL(`/users/${getCredentials('user_id')}/${entry.model_id}.${entry.framework}`, query.version ? {versionId: query.version} : {});
			entry.code = await fetch(module_url, {cache: 'reload'}).then(res => res.text());
			elem.querySelector('.actions').innerHTML = `<a class="button" href="/sandbox/${entry.model_id}">Back</a><a class="button" data-action="delete">Delete</a>`;
			populateForm(elem.querySelector('.submission-form'), entry);
			localStorage.setItem('mdx_submit_form', JSON.stringify(entry));
		} else {
			try {
				const data = JSON.parse(localStorage.getItem('mdx_submit_form'));
				populateForm(elem.querySelector('.submission-form'), data);
			} catch (e) {
				//localStorage.setItem('mdx_submit_form', '');
			}
		}
	}],
	['[data-action="publish"]', 'click', async e => {
		const form = e.target.closest('.form');
		const form_data = readForm(form, {lastUpdated: new Date().getTime()});
		const res = await fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'review', form: Object.assign(form_data, {model_id: entry?.model_id || false})})}).then(res => res.json());
		localStorage.removeItem('mdx_submit_form');
		localStorage.removeItem('mdx_submit_changes');
		document.querySelector('.main').dispatchEvent(new Event('refresh'));
		document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: `/sandbox/${res.id}`}})); // Should redirect to main if only publishing
	}],
	['[data-action="submit"]', 'click', async e => {
		const form = e.target.closest('.form');
		const form_data = readForm(form, {lastUpdated: new Date().getTime()});
		const res = await fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'upload', form: Object.assign(form_data, {model_id: entry?.model_id || false})})}).then(res => res.json());
		localStorage.removeItem('mdx_submit_form');
		localStorage.removeItem('mdx_submit_changes'); // TODO: upload only changed parts
		document.querySelector('.main').dispatchEvent(new Event('refresh'));
		document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: `/sandbox/${res.id}`}}));
	}],
	['[data-action="delete"]', 'click', async e => {
		if (!entry.model_id)
			return;
		const res = await fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'delete', model_id: entry.model_id, framework: entry.framework})}).then(res => res.json());
		document.querySelector('.main').dispatchEvent(new Event('refresh'));
		document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: `/`}}));
	}],
	['.section h3', 'click', e => {
		e.target.closest('.section').classList.toggle('hidden');
	}],
	['.entry [data-action="remove"]', 'click', e => {
		e.target.closest('.entry').remove();
		elem.dispatchEvent(new Event('update'));
	}],
	['.entry [data-action="duplicate"]', 'click', e => {
		const empty = e.target.closest('.entry');
		const cloned = empty.cloneNode(true);
		empty.parentElement.appendChild(cloned);
	}],
	['.toggle-values', 'click', e => {
		e.target.nextSibling.classList.toggle('hidden');
	}],
	['[name="type"]', 'change', e => {
		const entry = e.target.closest('.entry');
		const type = e.target.value;
		entry.querySelectorAll('[data-range]').forEach(item => item.style.display = 'none');
		entry.querySelector(`[data-range*="${type}"]`).style.display = 'block';
	}],
	['[data-action="builder"]', 'click', e => {
		const form = e.target.closest('.form');
		e.target.classList.add('disabled');
		form.querySelectorAll('[data-action="source"]').forEach(elem => elem.classList.remove('disabled'));
		form.querySelector('.editor.code').classList.add('hide');
		form.querySelector('.editor.builder').classList.remove('hide');
	}],
	['[data-action="source"]', 'click', e => {
		const form = e.target.closest('.form');
		e.target.classList.add('disabled');
		form.querySelectorAll('[data-action="builder"]').forEach(elem => elem.classList.remove('disabled'));
		form.querySelector('.editor.code').classList.remove('hide');
		form.querySelector('.editor.builder').classList.add('hide');
	}],
	['.editor textarea', 'keydown', e => {
		if (e.keyCode !== 9)
			return;
		e.preventDefault();
		const ss = e.target.selectionStart;
		const se = e.target.selectionEnd;
		if (ss !== se && e.target.value.slice(ss, se).indexOf('\n') !== -1) {
			const pre = e.target.value.slice(0, ss);
			const sel = e.target.value.slice(ss ,se).replace(/\n/g, '\n\t');
			const post = e.target.value.slice(se, e.target.value.length);
			e.target.value = pre.concat('\t').concat(sel).concat(post);
			e.target.selectionStart = ss + 1;
			e.target.selectionEnd = se + 1;
		} else {
			e.target.value = e.target.value.slice(0, ss).concat('\t').concat(e.target.value.slice(se, e.target.value.length));
			e.target.selectionStart = e.target.selectionEnd = ss + 1;
		}
	}],
	['[data-action="build-code"]', 'click', e => {
		const form = e.target.closest('.form');
		const pseudocode = form.querySelector('[name="pseudocode"]').value;
		const code = composeCode(pseudocode, {target_steps: 100});
		form.querySelector('[name="code"]').value = code;
	}],
	['[data-action="test-code"]', 'click', async e => { // TODO: move to function
		const form = e.target.closest('.form');
		const framework = form.querySelector('[name="framework"]').value;
		const code = form.querySelector('[name="code"]').value;
		if (framework === '' || code === '')
			return;
		const key = await fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'sandbox', framework, code})}).then(res => res.json()).then(json => json.key);
		new Promise(resolve => {
			const request = {
				id: 'sandbox',
				name: 'Sandbox',
				framework,
				sources: [
					{type: 'script', private: true, model_id: 'sandbox', framework}
				],
				fixed_params: {test: 1},
				variable_params: [{}],
				resolve
			};
			document.querySelector('.apocentric').dispatchEvent(new CustomEvent('distribute', {detail: request}));
		}).then(([result]) => {
			const error_box = elem.querySelector('.editor.code .error');
			error_box.classList.add('show');
			error_box.classList.remove('green');
			if (result.error)
				return error_box.innerHTML = result.error;
			error_box.innerHTML = 'Model code ran successfully';
			error_box.classList.add('green');
			for (const entry_type in result)
				entries(result[entry_type]).forEach(([name, value]) => cloneEntry(elem, entry_type, {name, label: name, units: name, default_value: value, type: isNaN(value) ? 'disc' : 'cont'})); // .filter(item => item.closest('.form, .entry') === form)
			Array.from(elem.querySelectorAll('[data-entry]')).forEach(item => {
			const name = item.querySelector('[name="name"]').value;
				if (name !== '' && result[item.dataset.entry] && !keys(result[item.dataset.entry]).includes(item.querySelector('[name="name"]').value)) {
					item.classList.add('error');
					const message = document.createElement('div');
					message.innerHTML = `Parameter '${name}' not found in model`;
					error_box.classList.remove('green');
					error_box.appendChild(message);
				}
			});
			elem.dispatchEvent(new Event('update'));
		});
	}],
	['[data-action="clear-form"]', 'click', e => {
		localStorage.removeItem('mdx_submit_form');
		document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: '/submit'}})); // Not the best solution, should be something internal
	}],
	['.search-button', 'click', e => {
		const field = elem.querySelector('[name="title"]');
		const query = field.value;
		e.target.parentElement.querySelectorAll('.search-results').forEach(item => item.remove());
		search(field, query);
	}],
	['.search-results [data-doi]', 'click', e => {
		const form = e.target.closest('.form');
		const results = e.target.closest('.search-results');
		const data = Object.assign({}, e.target.dataset);
		Object.keys(data).forEach(key => form.querySelectorAll(`[name="${key}"]`).forEach(item => item.value = data[key]));
		elem.dispatchEvent(new Event('update'));
		results.remove();
	}],
	['.submission-form input, .submission-form textarea', 'input', e => {
		if (env.timeouts.submit_save)
			clearTimeout(env.timeouts.submit_save);
		env.timeouts.submit_save = setTimeout(async () => {
			elem.dispatchEvent(new Event('update'));
		}, 1000);
	}],
];

export const submit = (env, {entry, query}, elem, storage={}) => ({
	render: async () => {
		const frameworks = {js: 'JavaScript', py: 'Python 3', R: 'R'};
		elem.innerHTML = await fetch('/pages/submit').then(res => res.text());
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: hooks(env, entry, query, elem)
});
