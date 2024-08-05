
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

const emception = async (code) => {
	const comlink = await import('/comlink.js');
	const { EmceptionWorker } = await import('/emception.worker.js');
	const emception = comlink.wrap(new EmceptionWorker());
	const compilation_flags = '';
	try {
		await emception.fileSystem.writeFile("/working/main.cpp", code);
		const cmd = `em++ ${flags} -sSINGLE_FILE=1 -sMINIFY_HTML=0 -sUSE_CLOSURE_COMPILER=0 main.cpp -o main.html`;
		const result = await emception.run(cmd);
		console.log(result);
	} catch (e) {
		console.log('Compilation error:', e);
	}
};

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
				if (Array.from(form.querySelectorAll(`[data-entry="${name}"]>[name="name"]`)).filter(item => item.value === entry.name).length > 0)
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

const pollS3 = async (url, retry_limit=20, increment=5) => {
	let retries = 0;
	while (++retries <= retry_limit) {
		await new Promise(resolve => setTimeout(resolve, increment * retries * 1000));
		try {
			const response = await fetch(url, {cache: 'no-cache', headers: {'Cache-Control': 'no-cache'}});
			if (!response.ok)
				throw 'Request failed';
			return response;
		} catch (e) {
			// Depending on fetch error, maybe stop polling
		}
	}
	throw 'Failed to load S3 object';
};

const queryGPT = async (form, code, options, autotest=true) => {
	const request_id = Math.round(Math.random() * 1e6);
	const request = await fetch(`https://d.modelrxiv.org/import`, {method: 'post', headers: {Authorization: `Basic ${getCredentials('token')}`, 'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({code, request_id}, options))}).then(res => res.json()).catch(e => ({error: e}));
	const tab = document.createElement('div');
	tab.dataset.tab = `tab_${request_id}`;
	tab.dataset.status = `edited`;
	tab.innerHTML = 'GPT Result <a data-icon="x" data-action="close"></a>';
	form.querySelector('.editor .tabs').appendChild(tab);
	const tab_content = document.createElement('div');
	form.querySelector('.editor').appendChild(tab_content);
	tab_content.classList.add('code', 'gpt');
	tab_content.dataset.tabContent = `tab_${request_id}`;
	tab_content.dataset.status = 'edited';
	tab_content.innerHTML = `<textarea name="code" class="loading">Waiting for GPT response</textarea>`;
	form.querySelector(`.editor .tabs [data-tab="tab_${request_id}"]`).dispatchEvent(new Event('click'));
	const t = setInterval(() => tab_content.querySelector('textarea.loading').value = tab_content.querySelector('textarea.loading').value + '.', 1000);
	try {
		const result = await pollS3(signedURL(`/users/${getCredentials('user_id')}/resources/${request_id}`), 10, 6).then(res => res.text());
		clearTimeout(t);
		const code_part = result.match(/[\`]{3}[a-zA-Z0-9]+\n(.*?)[\`]{3}/s) || ['', ''];
		const text_part = result.replace(/[\`]{3}.*?[\`]{3}/s, '');
		tab_content.innerHTML = `<textarea name="code">${code_part[1]}</textarea><div class="comment">${text_part}</div>`;
		if (autotest)
			document.querySelector('[data-action="test-code"]').click();
	} catch (e) {
		clearTimeout(t);
		tab_content.querySelector('textarea.loading').value = 'Failed to load result';
		console.log(e);
	}
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
	['.editor [data-tab]', 'click', e => {
		const editor = e.target.closest('.editor');
		editor.querySelectorAll('[data-tab]').forEach(elem => elem.classList.remove('selected'));
		e.target.classList.add('selected');
		editor.querySelectorAll('[data-tab-content]').forEach(elem => elem.classList.remove('show'));
		editor.querySelector(`[data-tab-content="${e.target.dataset.tab}"]`).classList.add('show');
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
		if (empty.nextSibling)
			empty.parentElement.insertBefore(cloned, empty.nextSibling);
		else
			empty.parentElement.appendChild(cloned);
	}],
	['.toggle-values', 'click', e => {
		e.target.nextSibling.classList.toggle('hidden');
	}],
	['[name="type"]', 'change', e => {
		const entry = e.target.closest('.entry');
		if (!entry)
			return;
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
	['[data-tab] [data-action="close"]', 'click', e => {
		const tab = e.target.closest('[data-tab]');
		const tab_name = tab.dataset.tab;
		tab.remove();
		elem.querySelector(`[data-tab-content="${tab_name}"]`).remove(); // Don't use "elem"
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
	['[data-action="compile-code"]', 'click', async e => {
		const form = e.target.closest('.form');
		const code = form.querySelector('.code.show [name="code"]').value;
		await emception(code);
	}],
	// Note that on refresh only the last tab is saved in model editor...
	['[data-action="import-code"]', 'click', async e => {
		const form = e.target.closest('.form');
		const prompt = form.querySelector('.code.show [name="code"]').value;
		const framework = form.querySelector('[name="framework"]').value || 'python';
		queryGPT(form, prompt, {framework});
	}],
	['[data-action="test-code"]', 'click', async e => { // TODO: move to function
		const form = e.target.closest('.form');
		const framework = form.querySelector('[name="framework"]').value;
		const tab = form.querySelector('.code.show').dataset.tabContent;
		const gpt = form.querySelector('.code.show').classList.contains('gpt');
		const code = form.querySelector('.code.show [name="code"]').value;
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
			const comment_box = elem.querySelector('.editor .code.show .comment');
			const error_box = document.createElement('div');
			comment_box.appendChild(error_box);
			error_box.classList.add('show');
			if (result.error) {
				form.querySelectorAll(`.editor [data-tab="${tab}"], .editor [data-tab-content="${tab}"]`).forEach(elem => elem.dataset.status = 'test-fail');
				if (gpt)
					queryGPT(form, code, {framework, error: result.error.toString()});
				return error_box.innerHTML = result.error;
			}
			error_box.innerHTML = 'Model code ran successfully';
			error_box.classList.add('green');
			form.querySelectorAll(`.editor [data-tab="${tab}"], .editor [data-tab-content="${tab}"]`).forEach(elem => elem.dataset.status = 'test-success');
			for (const entry_type in result)
				entries(result[entry_type]).forEach(([name, value]) => cloneEntry(elem, entry_type, {name, label: name, units: name, default_value: value, type: isNaN(value) ? 'disc' : 'cont'})); // .filter(item => item.closest('.form, .entry') === form)
			Array.from(elem.querySelectorAll('[data-entry]')).forEach(item => {
			const name = item.querySelector('[name="name"]').value;
				if (name !== '' && result[item.dataset.entry] && !keys(result[item.dataset.entry]).includes(item.querySelector('[name="name"]').value)) {
					item.classList.add('error');
					const message = document.createElement('div');
					message.innerHTML = `Parameter '${name}' not found in model`;
					form.querySelectorAll(`.editor [data-tab="${tab}"], .editor [data-tab-content="${tab}"]`).forEach(elem => elem.dataset.status = 'test-fail');
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
		elem.innerHTML = await fetch('/pages/submit').then(res => res.text());
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: hooks(env, entry, query, elem)
});
