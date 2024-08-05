import {queryFromPath, generateID} from '/apc/common.js';
import { getIDBObject, cacheString } from '/apc/cache.js';
import { readForm } from '/apc/form.js';
import { pollResult } from '/apc/jobs.js';
import { parseModelScheme } from '/model.js';

const entries = input => Object.entries(input instanceof Map ? Object.fromEntries(input) : input);
const keys = input => Object.keys(input instanceof Map ? Object.fromEntries(input) : input);

const getCredentials = async (property) => {
	const credentials = await getIDBObject('apc', 'auth', 'credentials');
	return credentials[property];
};

const queryGPT = async (form, request_type, scheme, code, code_error='', autotest=false) => {
	const request_id = Math.round(Math.random() * 1e6);
	const request = await fetch(`https://d.modelrxiv.org/import`, {method: 'post', headers: {Authorization: `Basic ${await getCredentials('token')}`, 'Content-Type': 'application/json'}, body: JSON.stringify({request_id, request_type, scheme, code, code_error})}).then(res => res.json()).catch(e => ({error: e}));
	try {
		const result = await pollResult(`/user/resources/${request_id}`).then(res => res.text());
		const code_part = result.match(/[\`]{3}([a-zA-Z0-9]+\n|)(.*?)[\`]{3}/s) || ['', '', ''];
		const text_part = result.replace(/[\`]{3}.*?[\`]{3}/gs, '');
		addCodeBox(form, generateID(6), 'OpenAI Response', code_part[2], text_part);
		if (autotest)
			document.querySelector('[data-action="test-code"]').click();
	} catch (e) {
		console.log(e);
	}
};

const hooks = (query, scheme, elem, timeouts) => [
	['.editor [data-tab]', 'click', e => {
		const editor = e.target.closest('.editor');
		editor.querySelectorAll('[data-tab]').forEach(elem => elem.classList.remove('selected'));
		e.target.classList.add('selected');
		editor.querySelectorAll('[data-tab-content]').forEach(elem => elem.classList.remove('selected'));
		editor.querySelector(`[data-tab-content="${e.target.dataset.tab}"]`).classList.add('selected');
	}],
	['[data-action="submit"]', 'click', async e => {
		const form = e.target.closest('.form');
		const form_data = {
			model_id: query.edit || false,
			scheme: form.querySelector('.scheme [data-tab-content].selected textarea').value,
			code: form.querySelector('.code [data-tab-content].selected textarea').value
		};
		const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'upload', form: form_data})}).then(res => res.json());
		console.log(res);
		window.location.href = `/sandbox/${query.edit || res.model_id}`;
	}],
	['[data-action="delete"]', 'click', async e => {
		if (!query.edit)
			return;
		const framework = scheme.framework;
		const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'delete', model_id: query.edit, framework})}).then(res => res.json());
		window.location.href = `/`;
	}],
	['.version-list [data-version]:not([data-tab])', 'click', async e => {
		const editor = e.target.closest('[data-editor]');
		const version_id = e.target.dataset.version;
		const framework = scheme.framework || 'py';
		const tab_content = editor.dataset.editor === 'scheme' ? await fetch(`/user/${scheme.model_id}.txt?versionId=${version_id}`, {cache: 'reload'}).then(res => res.text()) : await fetch(`/user/${scheme.model_id}.${framework}?versionId=${version_id}`, {cache: 'reload'}).then(res => res.text());
		addCodeBox(editor, generateID(6), `Version from ${e.target.innerText}`, tab_content, '', e.target);
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
	['[data-action="generate-scheme"]', 'click', async e => {
		if (e.target.classList.contains('loading'))
			return;
		e.target.classList.add('loading');
		const form = e.target.closest('.form');
		const scheme = form.querySelector('.scheme [data-tab-content].selected textarea').value;
		const code = form.querySelector('.code [data-tab-content].selected textarea').value;
		const code_error = form.querySelector('.code [data-tab-content].selected pre.error')?.innerText || '';
		await queryGPT(form.querySelector('[data-editor="scheme"]'), 'scheme', scheme, code, code_error);
		e.target.classList.remove('loading');
	}],
	['[data-action="convert-code"]', 'click', async e => {
		if (e.target.classList.contains('loading'))
			return;
		e.target.classList.add('loading');
		const form = e.target.closest('.form');
		const scheme = form.querySelector('.scheme [data-tab-content].selected textarea').value;
		const code = form.querySelector('.code [data-tab-content].selected textarea').value;
		const code_error = form.querySelector('.code [data-tab-content].selected pre.error')?.innerText || '';
		await queryGPT(form.querySelector('[data-editor="code"]'), 'code', scheme, code, code_error);
		e.target.classList.remove('loading');
	}],
	['[data-action="test-code"]', 'click', async e => {
		const form = e.target.closest('.form');
		const scheme = form.querySelector('.scheme [data-tab-content].selected textarea').value;
		const code = form.querySelector('.code [data-tab-content].selected textarea').value;
		if (code === '')
			return;
		const test_id = generateID(10);
		await cacheString(`/models/${test_id}.txt`, scheme);
		await cacheString(`/models/${test_id}.${scheme.framework || 'py'}`, code);
		const model_elem = document.createElement('div');
		model_elem.dataset.module = 'model';
		model_elem.classList.add('test-overlay');
		model_elem.innerHTML = `<div class="plots"></div>`;
		form.appendChild(model_elem);
		try {
			await import('/model.js').then(module => module.init(model_elem, `/model/${test_id}`));
			model_elem.dispatchEvent(new Event('run'));
			await new Promise((resolve, reject) => {
				model_elem.addEventListener('complete', resolve);
				model_elem.addEventListener('error', e => reject(e.detail.error));
			});
			form.querySelectorAll(`.editor [data-tab].selected, .editor [data-tab-content].selected`).forEach(elem => elem.dataset.status = 'success');
			model_elem.remove();
		} catch (e) {
			console.log(e);
			const comment_box = form.querySelector('.code [data-tab-content].selected .comment');
			const error_elem = document.createElement('pre');
			error_elem.classList.add('error');
			error_elem.innerText = e.message;
			comment_box.appendChild(error_elem);
			form.querySelectorAll(`.editor [data-tab].selected, .editor [data-tab-content].selected`).forEach(elem => elem.dataset.status = 'error');
			model_elem.remove();
		}
	}],
];

const addCodeBox = async (container, name, label, data, comment='', use_tab=undefined, position='before') => {
	if (data)
		await getIDBObject('mdx', 'tabs', name, data);
	const code = await getIDBObject('mdx', 'tabs', name);
	const code_box = document.createElement('div');
	code_box.dataset.tabContent = name;
	code_box.innerHTML = `<div class="header">${label}</div><textarea name="code">${code}</textarea><div class="comment">${comment}</div>`;
	if (position === 'before') {
		container.querySelectorAll('.code.selected').forEach(elem => elem.classList.remove('selected'));
		code_box.classList.add('code', 'selected');
	} else {
		code_box.classList.add('code');
	}
	container.appendChild(code_box);
	if (use_tab) {
		use_tab.dataset.tab = name;
		use_tab.click();
	} else {
		const tab = document.createElement('a');
		tab.dataset.tab = name;
		tab.innerText = label;
		if (position === 'before') {
			container.querySelectorAll('.version-list .selected').forEach(elem => elem.classList.remove('selected'));
			tab.classList.add('selected');
			container.querySelector('.version-list').insertBefore(tab, container.querySelector('.version-list [data-tab]:first-child'));
		} else
			container.querySelector('.version-list').appendChild(tab);
	}
	code_box.querySelector('textarea').addEventListener('change', e => {
		getIDBObject('mdx', 'tabs', name, e.target.value);
	});
};

export const init = async (elem) => {
	const query = queryFromPath(window.location.pathname);
	const model_id = query.edit;
	const scheme_text = model_id ? await fetch(`/user/${model_id}.txt`, {cache: 'reload'}).then(res => res.text()) : '';
	const scheme = model_id ? parseModelScheme(model_id, scheme_text) : {};
	if (model_id) {
		elem.querySelector('.upload-model-title').innerHTML = `<a class="fright" href="/sandbox/${model_id}">Back</a>Editing sandbox model`;
		const framework = scheme.framework || 'py';
		const code = await fetch(`/user/${model_id}.${framework}`, {cache: 'reload'}).then(res => res.text());
		await addCodeBox(document.querySelector('[data-editor="scheme"]'), generateID(6), 'Current version', scheme_text);
		await addCodeBox(document.querySelector('[data-editor="code"]'), generateID(6), 'Current version', code);
		const versions = await fetch(`https://d.modelrxiv.org/submit_beta?action=versions&model_id=${model_id}&framework=${framework}`, {method: 'get', headers: {Authorization: `Basic ${await getCredentials('token')}`, 'Content-Type': 'application/json'}}).then(res => res.json());
		versions['scheme_versions'].forEach(version => {
			const tab = document.createElement('a');
			tab.dataset.version = version.version;
			tab.innerText = version.date;
			document.querySelector('.scheme .version-list').appendChild(tab);
		});
		versions['model_versions'].forEach(version => {
			const tab = document.createElement('a');
			tab.dataset.version = version.version;
			tab.innerText = version.date;
			document.querySelector('.code .version-list').appendChild(tab);
		});
	} else {
		const example_scheme = await fetch('/pages/example_scheme.txt', {cache: 'reload'}).then(res => res.text());
		addCodeBox(document.querySelector('[data-editor="scheme"]'), generateID(6), 'Template', example_scheme);
		const example_model = await fetch('/pages/example_model.txt', {cache: 'reload'}).then(res => res.text());
		addCodeBox(document.querySelector('[data-editor="code"]'), generateID(6), 'Template', example_model);
	}
	const timeouts = {};
	addHooks(elem, hooks(query, scheme, elem, timeouts));
};
