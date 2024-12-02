import { queryFromPath, generateID, confirmBox } from '/apc/common.js';
import { deleteIDBObject, getIDBObject, cacheString } from '/apc/cache.js';
import { htmlFromFields, readForm } from '/apc/form.js';
import { pollResult } from '/apc/jobs.js';
import { parseModelScheme, defaultsFromScheme } from '/model.js';

const entries = input => Object.entries(input instanceof Map ? Object.fromEntries(input) : input);
const keys = input => Object.keys(input instanceof Map ? Object.fromEntries(input) : input);

const helper_form_structure = {
	'Metadata': [
		{type: 'text', name: 'title', label: 'Title', value: '', placeholder: 'Title of the study or model', required: true},
		{type: 'text', name: 'description', label: 'Description', value: '', placeholder: 'Brief description of the model', required: true},
		{type: 'text', name: 'authors', label: 'Authors', value: '', placeholder: 'Names of the authors', required: true},
		{type: 'text', name: 'doi', label: 'DOI', value: '', placeholder: 'DOI of the related publication', required: false},
		{type: 'text', name: 'type', label: 'Type', value: '', placeholder: 'Type of model (e.g., published, draft)', required: true},
		{type: 'text', name: 'publication_date', label: 'Publication Date', value: '', placeholder: 'Publication date (YYYY-MM-DD)', required: false},
		{type: 'text', name: 'keywords', label: 'Keywords', value: '', placeholder: 'Keywords, comma-separated', required: false},
		{type: 'select', name: 'framework', label: 'Framework', value: 'py', values: ['py', 'js'], required: true}
	],
	'Parameter': [
		{type: 'text', name: 'label', label: 'Label', value: '', placeholder: 'Parameter label (can include math notation)', required: true},
		{type: 'text', name: 'name', label: 'Name', value: '', placeholder: 'Parameter name in model code', required: true},
		{type: 'text', name: 'value', label: 'Value', value: '', placeholder: 'Default value of the parameter', required: true},
		{type: 'text', name: 'description', label: 'Description', value: '', placeholder: 'Description of the parameter (default: empty)', required: false}
	],
	'Plot': [
		{type: 'text', name: 'label', label: 'Label', value: '', placeholder: 'Plot label', required: true},
		{type: 'select', name: 'type', label: 'Type', value: 'line', values: ['line', 'lines', 'scatter', 'network_plot', 'mat', 'mat_grayscale', 'grid'], placeholder: 'Type of plot (default: line)', required: true},
		{type: 'text', name: 'x', label: 'x-axis input', value: '', placeholder: 'Name of output parameter for x-axis (comma-separated for multiple)', required: true},
		{type: 'text', name: 'y', label: 'y-axis input', value: '', placeholder: 'Name of output parameter for y-axis (comma-separated for multiple)', required: false},
		{type: 'text', name: 'data', label: 'Data input', value: '', placeholder: 'Name of output parameter for both axes', required: false},
		{type: 'text', name: 'xlabel', label: 'X Label', value: '', placeholder: 'x-axis label (default: x)', required: false},
		{type: 'text', name: 'ylabel', label: 'Y Label', value: '', placeholder: 'y-axis label (default: y)', required: false},
		{type: 'text', name: 'xlim', label: 'X Limits', value: '', placeholder: 'x-axis limits, comma-separated (default: 0,100)', required: false},
		{type: 'text', name: 'ylim', label: 'Y Limits', value: '', placeholder: 'y-axis limits, comma-separated (default: 0,1)', required: false}
	],
	'Preset': [
		{type: 'text', name: 'label', label: 'Label', value: '', placeholder: 'Preset label', required: true},
		{type: 'textarea', name: 'params', label: 'Parameter definitions', value: '', placeholder: 'Parameter definitions', required: true}
	],
	'Analysis': [
		{type: 'text', name: 'label', label: 'Analysis name', value: '', placeholder: 'Name for presets (must be identical to analysis= field)', required: true},
		{type: 'text', name: 'function', label: 'Function', value: '', placeholder: 'Name of the function to run the analysis', required: true},
		{type: 'select', name: 'type', label: 'Type', value: 'image', values: ['line', 'scatter', 'space_2d', 'image'], placeholder: 'Type of analysis output (default: image)', required: true},
		{type: 'text', name: 'xlabel', label: 'X Label', value: '', placeholder: 'x-axis label (default: x)', required: false},
		{type: 'text', name: 'ylabel', label: 'Y Label', value: '', placeholder: 'y-axis label (default: y)', required: false},
		{type: 'text', name: 'xlim', label: 'X Limits', value: '', placeholder: 'x-axis limits, comma-separated (default: 0,100)', required: false},
		{type: 'text', name: 'ylim', label: 'Y Limits', value: '', placeholder: 'y-axis limits, comma-separated (default: 0,1)', required: false}
	]
};


const getCredentials = async (property) => {
	const credentials = await getIDBObject('apc', 'auth', 'credentials');
	return credentials[property];
};

const queryLLM = async (form, scheme, code, code_error='', user_comments='', autotest=false) => {
	const request_id = generateID();
	const request_type = 'both';
	const request = await fetch(`https://d.modelrxiv.org/import`, {method: 'post', headers: {Authorization: `Basic ${await getCredentials('token')}`, 'Content-Type': 'application/json'}, body: JSON.stringify({request_id, request_type, scheme, code, code_error, user_comments})}).then(res => res.json()).catch(e => ({error: e}));
	try {
		const result = await pollResult(`/resources/${await getCredentials('user_id')}/${request_id}`, undefined, 200).then(res => res.text());
		const code_part = result.match(/[\`]{3}(python|javascript|code)(.*?)[\`]{3}/s) || ['', '', ''];
		const scheme_part = result.match(/[\`]{3}(text)(.*?)[\`]{3}/s) || ['', '', ''];
		const text_part = result.replace(/[\`]{3}.*?[\`]{3}/gs, '[code shown above]');
		if (code_part[2] !== '')
			addCodeBox('code', generateID(6), 'LLM Response', code_part[2]);
		if (scheme_part[2] !== '')
			addCodeBox('scheme', generateID(6), 'LLM Response', scheme_part[2]);
		const llm_response_pre = document.createElement('pre');
		llm_response_pre.innerText = text_part;
		document.querySelector('.llm-response-box').innerHTML = '';
		document.querySelector('.llm-response-box').appendChild(llm_response_pre);
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
		if (e.target.classList.contains('disabled') || e.target.classList.contains('loading'))
			return;
		e.target.classList.add('loading');
		const form = e.target.closest('.form');
		const form_data = {
			model_id: query.edit || false,
			scheme: form.querySelector('.scheme [data-tab-content].selected textarea').value,
			code: form.querySelector('.code [data-tab-content].selected textarea').value
		};
		const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'upload', form: form_data})}).then(res => res.json());
		deleteIDBObject('mdx', 'tabs', 'draft_scheme');
		deleteIDBObject('mdx', 'tabs', 'draft_code');
		window.location.href = `/sandbox/${query.edit || res.model_id}`;
	}],
	['[data-action="delete"]', 'click', async e => {
		if (!query.edit)
			return;
		if (await confirmBox('Delete model', 'Are you sure you want to delete this model?') !== 1)
			return;
		document.body.classList.add('loading');
		const framework = scheme.framework;
		const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'delete', model_id: query.edit, framework})}).then(res => res.json());
		window.location.href = `/`;
	}],
	['[data-action="save-draft"]', 'click', async e => {
		const form = e.target.closest('.form');
		const scheme_content = form.querySelector('.scheme [data-tab-content].selected textarea').value;
		const code_content = form.querySelector('.code [data-tab-content].selected textarea').value;
		getIDBObject('mdx', 'tabs', 'draft_scheme', scheme_content);
		getIDBObject('mdx', 'tabs', 'draft_code', code_content);
		e.target.classList.add('success');
		setTimeout(() => e.target.classList.remove('success'), 1000);
	}],
	['[data-action="clear-form"]', 'click', async e => {
		const form = e.target.closest('.form');
		if (await confirmBox('Clear form', 'Are you sure you want to clear the entire form?') !== 1)
			return;
		form.querySelector('.scheme [data-tab-content].selected textarea').value = '';
		form.querySelector('.code [data-tab-content].selected textarea').value = '';
		deleteIDBObject('mdx', 'tabs', 'draft_scheme');
		deleteIDBObject('mdx', 'tabs', 'draft_code');
	}],
	['.section h3', 'click', e => {
		e.target.closest('.section').classList.toggle('hidden');
	}],
	['.open-version-list', 'click', e => {
		e.target.closest('.versions-container').querySelector('.versions').classList.toggle('show');
	}],
	['[data-action="add-scheme-section"]', 'click', e => {
		const helper_container = e.target.closest('.editor').querySelector('.editor-helper-form');
		helper_container.classList.add('show');
		if (!e.target.dataset.type || !helper_form_structure[e.target.dataset.type]) {
			helper_container.innerHTML = `<h4><a class="fright" data-icon="x" data-action="hide"></a>Choose section type</h4>` + Object.keys(helper_form_structure).map(key => `<a class="button small" data-action="add-scheme-section" data-type="${key}">${key}</a>`).join('');
			return;
		}
		helper_container.dataset.type = e.target.dataset.type;
		helper_container.innerHTML = `<h4><a class="fright" data-icon="x" data-action="hide"></a>Add ${e.target.dataset.type}</h4>` + htmlFromFields(helper_form_structure[e.target.dataset.type], 'save', 'Save');
	}],
	['.editor-helper-form [data-action="hide"]', 'click', e => {
		e.target.closest('.editor-helper-form').classList.remove('show');
	}],
	['.editor-helper-form [data-action="save"]', 'click', e => {
		const form = e.target.closest('.editor-helper-form');
		form.querySelectorAll('[name].error').forEach(elem => elem.classList.remove('error'));
		const type = form.dataset.type;
		const form_structure = helper_form_structure[type];
		const form_data = readForm(form);
		for (const field of form_structure)
			if (field.required && !form_data[field.name])
				form.querySelector(`[name="${field.name}"]`).classList.add('error');
		if (form.querySelector('[name].error'))
			return;
		const section_text = `\n# ${type}${type !== 'metadata' ? `: ${form_data.label}` : ''}\n` + Object.keys(form_data).filter(key => key !== 'label' && form_data[key]).map(key => `${key}=${form_data[key]}`).join('\n')+'\n';
		const scheme_textarea = document.querySelector('.scheme [data-tab-content].selected textarea');
		scheme_textarea.value = scheme_textarea.value + section_text;
		form.classList.remove('show');
	}],
	['[data-action="load-example"]', 'click', async e => {
		if (e.target.classList.contains('loading'))
			return;
		if (await confirmBox('Load example code', 'This will load an example model, you can return to your previous code using the "Previous versions" menu.') !== 1)
			return;
		e.target.classList.add('loading');
		const example_scheme = await fetch('/pages/example_scheme.txt', {cache: 'reload'}).then(res => res.text());
		addCodeBox('scheme', generateID(6), 'Example model scheme', example_scheme);
		const example_model = await fetch('/pages/example_model.txt', {cache: 'reload'}).then(res => res.text());
		addCodeBox('code', generateID(6), 'Example model code', example_model);
		e.target.remove();
	}],
	['.version-list [data-version]:not([data-tab])', 'click', async e => {
		const editor = e.target.closest('[data-editor]');
		const version_id = e.target.dataset.version;
		const framework = scheme.framework || 'py';
		const tab_content = editor.dataset.editor === 'scheme' ? await fetch(`/user/${scheme.model_id}.txt?versionId=${version_id}`, {cache: 'reload'}).then(res => res.text()) : await fetch(`/user/${scheme.model_id}.${framework}?versionId=${version_id}`, {cache: 'reload'}).then(res => res.text());
		addCodeBox(editor.dataset.editor, generateID(6), `Version from ${e.target.innerText}`, tab_content, e.target);
	}],
	['.editor textarea[name="code"]', 'keydown', e => {
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
	['[data-action="convert-code"]', 'click', async e => {
		if (e.target.classList.contains('loading'))
			return;
		const form = e.target.closest('.form');
		e.target.closest('.section').classList.remove('hidden');
		const scheme_textarea = form.querySelector('.scheme [data-tab-content].selected textarea');
		const code_textarea = form.querySelector('.code [data-tab-content].selected textarea');
		const user_comments_textarea = form.querySelector('.user-llm-comments textarea');
		[scheme_textarea, code_textarea, user_comments_textarea].forEach(elem => {
			elem.setAttribute('disabled', 'disabled');
			elem.parentElement.classList.add('loading');
		});
		form.querySelector('[data-action="submit"]').classList.add('disabled');
		document.querySelectorAll('[data-action="convert-code"]').forEach(item => item.classList.add('loading'));
		const scheme = scheme_textarea.value;
		const code = code_textarea.value;
		const code_error = form.querySelector('.code-error-box[data-status="error"] pre')?.innerText || '';
		const user_comments = user_comments_textarea.value || '';
		await queryLLM(form, scheme, code, code_error, user_comments);
		user_comments_textarea.value = '';
		[scheme_textarea, code_textarea, user_comments_textarea].forEach(elem => {
			elem.removeAttribute('disabled', 'disabled');
			elem.parentElement.classList.remove('loading');
		});
		document.querySelectorAll('[data-action="convert-code"]').forEach(item => item.classList.remove('loading'));
	}],
	['[data-action="test-code"]', 'click', async e => {
		const test_button = e.target;
		if (test_button.classList.contains('loading'))
			return;
		test_button.classList.add('loading');
		const form = test_button.closest('.form');
		const error_box = form.querySelector('.code-error-box');
		error_box.dataset.status = '';
		error_box.innerHTML = '';
		form.querySelector('[data-action="submit"]').classList.add('disabled');
		test_button.closest('.section').classList.remove('hidden');
		window.scrollTo({
			top: test_button.closest('.section').offsetTop - 20,
			behavior: 'smooth'
		});
		const scheme_text = form.querySelector('.scheme [data-tab-content].selected textarea').value;
		const code_text = form.querySelector('.code [data-tab-content].selected textarea').value;
		if (code_text === '') {
			const notice_elem = document.createElement('pre');
			notice_elem.innerText = 'Your model code is empty';
			error_box.dataset.status = 'error';
			error_box.appendChild(notice_elem);
			test_button.classList.remove('loading');
			return;
		}
		const scheme = parseModelScheme('sandbox', scheme_text);
		if (!scheme.plot) {
			const notice_elem = document.createElement('pre');
			notice_elem.innerText = 'Your model does not contain any plots. This interface is currently designed to test dynamics. If your model includes analyses, you will need to test these after saving your model.';
			error_box.dataset.status = 'warning';
			error_box.appendChild(notice_elem);
			form.querySelector('[data-action="submit"]').classList.remove('disabled');
			test_button.classList.remove('loading');
			return;
		}
		const test_id = generateID(10);
		await cacheString(`/models/${test_id}.txt`, scheme_text);
		await cacheString(`/models/${test_id}.${scheme.framework || 'py'}`, code_text, scheme.framework === 'js' ? 'application/javascript': 'text/plain');
		const model_elem = document.createElement('div');
		model_elem.dataset.module = 'model';
		model_elem.classList.add('test-box');
		model_elem.innerHTML = `<div class="plots"></div>`;
		form.querySelector('.model-preview-box').innerHTML = '';
		form.querySelector('.model-preview-box').appendChild(model_elem);
		try {
			await import('/model.js').then(module => module.init(model_elem, `/model/${test_id}`)).catch(e => {
				throw `Error initiating model: ${e}`;
			});
			model_elem.dispatchEvent(new Event('run'));
			await new Promise((resolve, reject) => {
				model_elem.addEventListener('complete', resolve);
				model_elem.addEventListener('worker_error', e => reject(e.detail.error));
				model_elem.addEventListener('error', e => reject(e.detail.error));
			});
			const notice_elem = document.createElement('pre');
			error_box.dataset.status = 'success';
			notice_elem.innerText = 'Your model dynamics ran successfully. If the dynamics output is incorrect, you can edit your code manually and rerun the test, or try to fix the problem using the AI-assisted conversion pipeline.';
			error_box.appendChild(notice_elem);
			form.querySelectorAll(`.editor [data-tab].selected, .editor [data-tab-content].selected`).forEach(elem => elem.dataset.status = 'success');
			form.querySelector('[data-action="submit"]').classList.remove('disabled');
		} catch (e) {
			const notice_elem = document.createElement('pre');
			error_box.dataset.status = 'error';
			notice_elem.innerText = e.message || e;
			error_box.appendChild(notice_elem);
			form.querySelectorAll(`.editor [data-tab].selected, .editor [data-tab-content].selected`).forEach(elem => elem.dataset.status = 'error');
			model_elem.remove();
		}
		test_button.classList.remove('loading');
	}],
];

const addCodeBox = async (editor_label, name, label, data, use_tab=undefined, position='before') => {
	const container = document.querySelector(`[data-editor="${editor_label}"]`);
	if (data !== undefined)
		await getIDBObject('mdx', 'tabs', name, data);
	const code = await getIDBObject('mdx', 'tabs', name);
	const code_box = document.createElement('div');
	code_box.dataset.tabContent = name;
	code_box.innerHTML = `<div class="header">${label}</div><textarea name="code" placeholder="${editor_label === 'scheme' ? 'Your model scheme goes here. You can add sections using the \'Add section\' button or generate it using the AI-assistant.' : 'Write or paste your code here...'}">${code}</textarea>`;
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
		elem.querySelector('.upload-model-title').innerHTML = `<a class="fright button" href="/sandbox/${model_id}">Back</a><a class="fright button" data-action="delete">Delete</a>Editing sandbox model`;
		elem.querySelector('[data-action="save-draft"]').remove();
		const framework = scheme.framework || 'py';
		const code = await fetch(`/user/${model_id}.${framework}`, {cache: 'reload'}).then(res => res.text());
		await addCodeBox('scheme', generateID(6), 'Current version', scheme_text);
		await addCodeBox('code', generateID(6), 'Current version', code);
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
		const scheme_content = await getIDBObject('mdx', 'tabs', 'draft_scheme').then(scheme => {
			if (!scheme)
				return fetch('/pages/empty_scheme.txt', {cache: 'reload'}).then(res => res.text());
			return scheme;
		});
		const code_content = await getIDBObject('mdx', 'tabs', 'draft_code').then(code => {
			if (!code) {
				const load_example_button = document.createElement('div');
				load_example_button.classList.add('editor-helper');
				load_example_button.innerHTML = '<a class="button" data-action="load-example">Load example</a>';
				document.querySelector('[data-editor="code"]').appendChild(load_example_button);
				return '';
			}
			return code;
		});
		addCodeBox('code', generateID(6), 'Model code', code_content);
		addCodeBox('scheme', generateID(6), 'Empty scheme', scheme_content);
	}
	const timeouts = {};
	document.querySelector('.section.code-step').classList.remove('hidden');
	addHooks(elem, hooks(query, scheme, elem, timeouts));
};
