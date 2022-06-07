
const formatLabel = text => {
	const label = text.replace(/(^|[^a-zA-Z])([a-zA-Z])(_|\^)(\{([^\{]+)\}|[a-zA-Z0-9])/, (_, pre, name, type, sub, sub_curly) => `${pre}${name}<${type === '_' ? 'sub' : 'sup'}>${sub_curly || sub}</${type === '_' ? 'sub' : 'sup'}>`);
	return text.match(/^[a-zA-Z](_|$)/) ? `<i>${label}</i>` : label;
};

const fieldsFromForm = (input_params, query) => {
	return input_params.map(param => {
		const {name, label, type, default_value, range: _range, values, description} = param;
		const range = _range ? _range.split(',') : [0, 1]; // Temp
		const input_field = (() => {
			switch(type) {
				case 'vector':
				case 'cont':
					return `<input type="text" data-type="${type}" class="value" name="${name}" value="${query && query[name] !== undefined ? query[name] : default_value}" title="${description}"><input type="text" class="range" name="${name}" value="${range[0]}" title="${description} range start"><input type="text" class="range" name="${name}" value="${range[1]}" title="${description} range end"><input type="text" class="range" name="${name}" value="5" title="${description} resolution (2^x)">`;
				case 'disc':
					return values ? `<select class="value" data-type="cont" name="${name}" title="${description}">${values.map(flag => `<option value="${flag.name}"${(query && query[name] !== undefined ? query[name] : default_value) === flag.name ? 'selected' : ''}>${flag.name}</option>`).join('')}</select>` : `<input type="text" data-type="${type}" class="value" name="${name}" value="${query && query[name] !== undefined ? query[name] : default_value}" title="${description}">`;
				case 'json':
					return `<input type="text" data-type="json" class="value" name="${name}" value="${query && query[name] !== undefined ? query[name] : default_value}" title="${description}">`;
			}
		})();
		return `<div class="option" data-name="${name}" data-type="${type}" data-label="${label}"><label title="${description}"><input type="text" disabled="disabled">${formatLabel(label)}</label><div class="values">${input_field}</div></div>`;
	}).join('');
};

const draw = (container, data, offset=0, flush=false) => { // TODO: move preview flag elsewhere/combine with below
	container.querySelectorAll(`[data-plot][data-name]`).forEach((plot,i) => data[0][plot.dataset.name] !== undefined ? plot.dispatchEvent(new CustomEvent('update', {detail: {data: data.map(step => step[plot.dataset.name]), offset, flush}})) : 0);
};

const pythonModuleWrapper = async (module, reload=false) => ({
	module: await fetch(module.module_url, {cache: reload ? 'no-cache' : 'default'}).then(res => res.text()),
	pyodide: await (async () => {
		try {
			if (typeof loadPyodide !== 'function')
				await loadScript('/pyodide/pyodide.js');
			const pyodide = await loadPyodide({indexURL: 'https://modelrxiv.org/pyodide/'});
			await pyodide.loadPackage('numpy');
			await pyodide.loadPackage('matplotlib');
			if (module.modules) {
				for (const module_name of module.modules.split(','))
					await pyodide.loadPackage(module_name);
			}
			return pyodide;
		} catch (e) {
			return pyodide;
			// Ignore "already loaded" error
		}
	})(),
	step: function (params, _step, t) {
		const code = `${this.module}
out = step(params, _step, ${t})
`;
		this.pyodide.globals.set('params', this.pyodide.toPy(params));
		this.pyodide.globals.set('_step', this.pyodide.toPy(_step));
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('out');
		if (!outputPr)
			return false;
		const out = outputPr.toJs();
		outputPr.destroy();
		return out instanceof Map ? Object.fromEntries(out) : out;
	}
});

const stepWrapper = (container, step_module, params, _step, storage=[]) => {
	const t = storage.length;
	const plots_container = container.querySelector('.plots');
	const complete = (params, storage) => { // TODO: decide how result is handled in dynamics mode
		const result = step_module.result ? step_module.result(params, storage) : {};
		container.querySelector('.result-tab').innerHTML = '<h4>Result</h4><pre>'+Object.entries(result).map(([param, value]) => `${param}: ${value}\n`).join('')+'</pre>';
		//container.querySelector('.result-tab').classList.add('show');
		setTimeout(() => {
			container.querySelector('.result-tab').classList.remove('show');
		}, 5000);
		draw(plots_container, storage, 0, true);
		return false;
	};
	if (t - 1 === parseInt(params.target_steps)) {
		complete(params, storage);
		return false;
	} else {
		const step = step_module.step(params, _step, t);
		if (!step)
			return complete(params, storage);
		storage.push(step);
		draw(plots_container, storage, 0, true); // storage.slice(storage.length - 2), storage.length - 2);
		return step;
	}
};

const parsePresets = (presetText) => {
	const cache = [];
	const presets = [];
	const formatPreset = input => ({label: input[0], type: input.slice(1).reduce((a,param) => a || param[1].match(/\[([0-9\.\-e,]+)\]/), false) ? 'grid' : 'dynamics', text: input.slice(1).map(v => v.join(' = ')).join('\n'), params: input.slice(1).map(v => v.join('=')).join(';')});
	presetText.split('\n').forEach(line => {
		if (line.startsWith('#')) {
			if (cache.length > 0)
				presets.push(formatPreset(cache));
			cache.length = 0;
			cache.push(line.replace(/^[#]+[ ]*/, ''));
			return;
		} else if (line === '')
			return;
		const parts = line.replace(/[ ]*/g, '').split('=');
		cache.push(parts);
	});
	if (cache.length > 0)
		presets.push(formatPreset(cache));
	return presets;
};

const runGrid = (entry, form, defaults, plots_elem, title) => {
	const params = numericize(readForm(form, defaults));
	const selected = Array.from(form.querySelectorAll('.option.selected'));
	if (selected.length === 0)
		return;
	const param_ranges = selected.reduce((a,field) => Object.assign(a, {[field.querySelector('label input').value]: {name: field.dataset.name, type: field.dataset.type, label: field.dataset.label, range: field.dataset.type === 'select' ? Array.from(field.querySelectorAll('.values option')).map(option => option.value) : Array.from(field.querySelectorAll('.range')).map(input => +(input.value))}}), {});
	import('./meta.js').then(meta => meta.init(plots_elem, entry, Object.assign({}, params), param_ranges, title));
};

const defaultsFromInput = input_params => input_params.reduce((defaults, param) => Object.assign(defaults, {[param[0]]: param[3]}), {});

export const model = (env, {entry, query}, elem, storage={}) => ({
	render: async () => {
		elem.dataset.type = `${entry.type || 'published'}${entry.private ? ' sandbox' : ''}`;
		entry.module_url = entry.private ? signedURL(`/users/${getCredentials('user_id')}/${entry.model_id}.${entry.framework}`) : `/models/${entry.model_id}.${entry.framework}`; // Better to avoid updating entry
		const input_params = entry.input_params || [];
		const uri = `/${entry.private ? 'sandbox' : 'model'}/${entry.model_id}`;
		const presets = entry.presets ? parsePresets(entry.presets) : [];
		const presetHTML = presets.map(preset => `<div class="preset"><a data-preset="${preset.params}" data-title="${preset.label}" data-type="${preset.type}" title="${preset.text}">${preset.label}</a></div>`).join('');
		switch(true) {
			case entry.preview: // Date: ${new Date(entry.lastUpdated).toLocaleString('default', {year: 'numeric', month: 'long'})}
				elem.innerHTML = `<div class="details"><div class="fright"><a data-category="${entry.type || 'published'}">${entry.type || 'published'}</a></div><h3><a href="${uri}" class="title">${entry.title || 'Untitled model'}</a></h3><h4>${typeof entry.authors === 'string' ? entry.authors : `${entry.authors[0]}${entry.authors.length > 2 ? ` <a title="${entry.authors.slice(1).join(', ')}">[...]</a>` : ''}`}</h4>${entry.tags ? `<p>${entry.tags.map(v => `<a href="/tag/${v}" data-tag="${v}">#${v}</a>`).join('')}</p>` : ''}</div>`;
				break;
			default:
				const option_fields = fieldsFromForm(input_params, query);
				elem.innerHTML = `<div class="fright"><div data-framework="${entry.framework}">.${entry.framework}</div></div><h2>${entry.title}</h2><div class="authors">${entry.authors || ''}. ${entry.doi ? `<a href="https://doi.org/${entry.doi}" target="_blank">doi:${entry.doi}</a>` : ''}</div><div class="description shorten">${entry.description || ''}</div><div class="tabs"><div class="result-tab menu"></div><div class="parameters-menu menu show multiple-tabs"><div class="tabs"><a data-tab="parameters" class="selected">Parameters</a><a data-tab="presets">Presets</a><a data-tab="saved">Saved</a></div><div data-tab-content="parameters" class="form show">${option_fields}<div class="clear space"><a class="button" data-action="grid" title="Meta analysis using selected parameters">Grid</a><a data-action="update" class="button">Update</a><a data-action="save" class="button">Save</a><div class="clear"></div></div></div><div data-tab-content="presets">${presetHTML}</div><div data-tab-content="saved"></div></div><a class="fright" data-action="parameters-menu" title="Parameters" data-icon="f">Parameters</a><a class="fright" data-action="restart" title="Restart" data-icon="r">Restart</a><a class="fright" data-action="start" title="Start/Pause" data-icon="p">Run</a><a class="${!query.code && !query.pseudocode ? 'selected' : ''}" href="${uri}">Model</a>${entry.private ? `<a href="/edit/${entry.model_id}">Edit</a><a title="Make the model publicly available (subject to review)" data-action="publish">Publish</a>` : '<a title="Create a local copy of the model" data-action="copy">Copy</a>'}<a class="${query.code ? 'selected' : ''}" href="${uri}/code/latest">Code</a>${entry.pseudocode ? `<a class="${query.pseudocode ? 'selected' : ''}" href="${uri}/pseudocode/latest">Equations</a>` : ''}</div>${query.code || query.pseudocode ? '<div class="editor line-numbers"><div class="watermark">Powered by Prism.js</div><pre><code class="language-javascript"></code></pre></div>' : '<div class="plots" data-empty="Initiate model to load results"></div>'}`;
				elem.dispatchEvent(new CustomEvent('init', {detail: {group: true}}));
				break;
		}
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="model"]', 'init', async e => {
			switch(true) { // Move elsewhere
				case query.code !== undefined:
					const code = await fetch(entry.module_url, {cache: 'reload'}).then(res => res.text());
					elem.querySelector('.editor code').innerHTML = code;
					await loadScript('/ext/prism.js');
					Prism.highlightElement(elem.querySelector('.editor code'));
					break;
				case query.pseudocode !== undefined:
					elem.querySelector('.editor code').setAttribute('class', 'language-python');
					elem.querySelector('.editor code').innerHTML = entry.pseudocode;
					await loadScript('/ext/prism.js');
					Prism.highlightElement(elem.querySelector('.editor code'));
					break;
				case elem.querySelector('.plots') !== null:
					const {plotsFromOutput, groupPlots} = await import('./plot.js');
					const plots_container = elem.querySelector('.plots');
					storage.params = numericize(readForm(elem.querySelector('.parameters-menu .form'), defaultsFromInput(entry.input_params)));
					await Promise.all(plotsFromOutput(entry).map(plot => {
						if (!plots_container.querySelector(`[data-name="${plot.name}"]`)) {
							const group = document.createElement('div');
							group.classList.add('group');
							plots_container.appendChild(group);
							return addModule(group, 'plot').then(({module: plot_module}) => plot_module.dispatchEvent(new CustomEvent('init', {detail: {plot, params: storage.params}})))
						} else
							plots_container.querySelector(`[data-name="${plot.name}"]`).dispatchEvent(new CustomEvent('modify', {detail: {plot: {xbounds: plot.xbounds}, params: storage.params}}));
					}));
					if (e.detail?.group)
						groupPlots(plots_container);
			}
			if (e.detail?.resolve)
				e.detail.resolve();
		}],
		['[data-module="model"]', 'run', async e => {
			const plots_container = elem.querySelector('.plots');
			const step_interval = localStorage.getItem('mdx_step_interval') || 10;
			if (!storage.loop || e.detail?.reset) {
				await new Promise(resolve => e.target.dispatchEvent(new CustomEvent('init', {detail: {save: false, resolve}})));
				const request = {framework: entry.framework, sources: [{type: 'script', private: entry.private, model_id: entry.model_id, framework: entry.framework}], params: storage.params};
				const stream = await new Promise(resolve => document.querySelector('.apocentric').dispatchEvent(new CustomEvent('dynamics', {detail: {request, resolve}}))).then(stream => stream.getReader());
				const step_storage = [];
				if (storage.timeout)
					clearTimeout(storage.timeout);
				storage.loop = async () => {
					if (!document.body.contains(elem))
						return;
					if (e.target.dataset.state === 'paused')
						await new Promise(resolve => e.target.addEventListener('run', resolve, {once: true}));
					const step = await stream.read();
					if (step.done)
						return e.target.dispatchEvent(new Event('stopped'));
					step_storage.push(step.value);
					if (step_storage.length > 100)
						step_storage.shift();
					draw(plots_container, step_storage, 0, true);
					storage.timeout = setTimeout(storage.loop, step_interval);
				};
			}
			if (e.target.dataset.state !== 'paused')
				storage.loop();
			e.target.dataset.state = 'running';
			elem.querySelectorAll('[data-action="start"]').forEach(item => item.dataset.icon = 'P');
		}],
		['[data-module="model"]', 'run_browser', async e => {
			const step_interval = localStorage.getItem('mdx_step_interval') || 10;
			if (storage.step_module === undefined || e.detail?.reload) {
				storage.step_module = entry.framework === 'js' ? await import(`${entry.module_url}${e.detail?.reload ? `?${new Date().getTime()}` : ''}`) : (entry.framework === 'py' ? await pythonModuleWrapper(entry, e.detail?.reload) : false);
			}
			if (!storage.loop || e.detail?.reset) {
				//e.target.dispatchEvent(new CustomEvent('init', {detail: {save: false}}));
				await new Promise(resolve => e.target.dispatchEvent(new CustomEvent('init', {detail: {save: false, resolve}})));
				const stats = []; // Rename
				if (storage.timeout)
					clearTimeout(storage.timeout);
				storage.loop = async (_step) => {
					if (!document.body.contains(elem))
						return;
					if (e.target.dataset.state === 'paused')
						await new Promise(resolve => e.target.addEventListener('run_browser', resolve, {once: true}));
					const step = stepWrapper(elem, storage.step_module, storage.params, _step, stats);
					if (!step)
						return e.target.dispatchEvent(new Event('stopped'));
					storage.timeout = setTimeout(storage.loop, step_interval, step);
				};
			}
			if (e.target.dataset.state !== 'paused')
				storage.loop();
			e.target.dataset.state = 'running';
			elem.querySelectorAll('[data-action="start"]').forEach(item => item.dataset.icon = 'P');
		}],
		['[data-module="model"]', 'save', e => {
			const plots_container = elem.querySelector('.plots');
			const id = Math.round(1e7*Math.random());
			const cloned = plots_container.cloneNode(true);
			cloned.setAttribute('class', 'archived-plots');
			cloned.dataset.saved = id;
			plots_container.parentElement.appendChild(cloned);
			const button = document.createElement('div');
			button.classList.add('preset');
			button.innerHTML = `<a data-saved="${id}" data-type="dynamics" title="">Saved plots</a>`;
			elem.querySelector('[data-tab-content="saved"]').appendChild(button);
		}],
		['[data-module="model"]', 'pause', e => {
			e.target.dataset.state = 'paused';
			elem.querySelectorAll('[data-action="start"]').forEach(item => item.dataset.icon = 'p');
		}],
		['[data-module="model"]', 'stopped', e => {
			e.target.dataset.state = 'stopped';
			elem.querySelectorAll('[data-action="start"]').forEach(item => item.dataset.icon = 'p');
			delete storage.loop;
		}],
		['a[data-saved]', 'click', e => {
			const id = e.target.dataset.saved;
			e.target.classList.toggle('selected');
			elem.querySelector(`.archived-plots[data-saved="${id}"]`).classList.toggle('show');
		}],
		['.menu [data-tab]', 'click', e => {
			const menu = e.target.closest('.menu');
			const multiple = menu.classList.contains('multiple-tabs');
			if (multiple) {
				e.target.classList.toggle('selected');
				menu.querySelector(`[data-tab-content="${e.target.dataset.tab}"]`).classList.toggle('show');
			} else {
				menu.querySelectorAll('[data-tab]').forEach(elem => elem.classList.remove('selected'));
				menu.querySelectorAll('[data-tab-content]').forEach(elem => elem.classList.remove('show'));
				e.target.classList.add('selected');
				menu.querySelector(`[data-tab-content="${e.target.dataset.tab}"]`).classList.add('show');
			}
		}],
		['[data-action="settings-menu"]', 'click', e => {
			const plot = e.target.closest('.plot');
			plot.querySelector('.settings-menu').classList.toggle('show');
		}],
		['[data-action="parameters-menu"]', 'click', e => {
			elem.querySelector('.parameters-menu').classList.toggle('show');
		}],
		['[data-action="start"]', 'click', e => {
			if (elem.dataset.state !== 'running')
				elem.dispatchEvent(new Event(localStorage.getItem('mdx_state') === 'test' ? 'run' : 'run_browser'));
			else
				elem.dispatchEvent(new Event('pause'));
		}],
		['[data-action="restart"]', 'click', e => {
			elem.dispatchEvent(new CustomEvent(localStorage.getItem('mdx_state') === 'test' ? 'run' : 'run_browser', {detail: {reset: true}}));
		}],
		['[data-action="save"]', 'click', e => {
			elem.dispatchEvent(new Event('save'));
		}],
		['[data-action="run_model"]', 'click', e => {
			const menu = e.target.closest('.data-menu');
			const model = e.target.closest('[data-model]');
			const plot = e.target.closest('[data-plot]');
			const display = plot.querySelector('svg, canvas');
			const param_ranges = JSON.parse(plot.dataset.param_ranges);
			const [x, y] = [
				param_ranges.x.range[0] + (param_ranges.x.range[1] - param_ranges.x.range[0]) * menu.dataset.x / display.getBoundingClientRect().width,
				param_ranges.y.range[0] + (param_ranges.y.range[1] - param_ranges.y.range[0]) * (1 - menu.dataset.y / display.getBoundingClientRect().height)
			];
			const params = Object.assign(JSON.parse(plot.dataset.params), {[param_ranges.x.name]: x, [param_ranges.y.name]: y});
			elem.querySelectorAll(`.parameters-menu .option.selected label`).forEach(elem => elem.click());
			for (const param of Object.entries(params)) {
				if (!elem.querySelector(`.parameters-menu [name="${param[0]}"]`))
					continue;
				const current_value = elem.querySelector(`.parameters-menu [name="${param[0]}"]`).value;
				if (current_value == param[1])
					continue;
				elem.querySelector(`.parameters-menu [name="${param[0]}"]`).value = param[1];
				elem.querySelector(`.parameters-menu [name="${param[0]}"]`).classList.add('highlight');
				setTimeout(() => {
					elem.querySelector(`.parameters-menu [name="${param[0]}"]`).classList.remove('highlight');
				}, 500);
			}
			elem.dispatchEvent(new Event('run'));
			menu.classList.remove('show');
		}],
		['[data-preset]', 'click', async e => {
			const preset = e.target.dataset.preset.split(';').map(v => v.split('='));
			const title = e.target.dataset.title;
			elem.querySelectorAll(`.parameters-menu .option.selected label`).forEach(elem => elem.click());
			for (const param of preset) {
				const range_string = param[1].match(/\[([0-9\.\-e,]+)\]/);
				if (range_string) {
					const range_values = range_string[1].split(',');
					elem.querySelectorAll(`.parameters-menu .option[data-name="${param[0]}"] label`).forEach(elem => elem.click());
					elem.querySelectorAll(`.parameters-menu [name="${param[0]}"].range`)[0].value = range_values[0];
					elem.querySelectorAll(`.parameters-menu [name="${param[0]}"].range`)[1].value = range_values[1];
					elem.querySelectorAll(`.parameters-menu [name="${param[0]}"].range`)[2].value = range_values[2] || 8;
				} else {
					const current_value = elem.querySelector(`.parameters-menu [name="${param[0]}"]`).value;
					if (current_value === param[1])
						continue;
					elem.querySelector(`.parameters-menu [name="${param[0]}"]`).value = param[1];
					elem.querySelector(`.parameters-menu [name="${param[0]}"]`).classList.add('highlight');
					setTimeout(() => {
						elem.querySelector(`.parameters-menu [name="${param[0]}"]`).classList.remove('highlight');
					}, 500);
				}
			}
			const selected = elem.querySelectorAll('.parameters-menu .option.selected');
			if (selected.length > 0)
				runGrid(entry, elem.querySelector('.parameters-menu .form'), query, elem.querySelector('.plots'), title);
			else
				elem.dispatchEvent(new Event('run'));
		}],
		['.option label', 'click', e => {
			const option = e.target.closest('.option');
			if (option.classList.contains('selected')) {
				option.querySelector('label input').value = '';
				return option.classList.remove('selected');
			}
			const letters = ['x', 'y', 'z', 's']; // TODO: replace this solution
			const selected = Array.from(e.target.closest('.form').querySelectorAll('.option.selected'));
			const current_dims = selected.map(elem => elem.querySelector('label input').value);
			const remaining_dims = letters.filter(v => !current_dims.includes(v));
			if (remaining_dims.length > 0) {
				option.classList.add('selected');
				option.querySelector('label input').value = remaining_dims[0];
			}
		}],
		['[data-action="grid"]', 'click', e => {
			runGrid(entry, elem.querySelector('.parameters-menu .form'), query, elem.querySelector('.plots'));
		}],
		['[data-action="copy"]', 'click', e => {
			fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'copy', model_id: entry.model_id, framework: entry.framework})}).then(res => res.json())
				.catch(e => {
					console.log('Failed to copy model', e);
				})
				.then(res => {
					document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: `/sandbox/${res.model_id}`}}));
				});
		}],
		['[data-action="publish"]', 'click', e => {
			fetch(`https://d.modelrxiv.org/submit`, {method: 'POST', headers: {Authorization: `Basic ${getCredentials('token')}`}, body: JSON.stringify({action: 'publish', model_id: entry.model_id, framework: entry.framework})}).then(res => res.json())
				.catch(e => {
					console.log('Failed to publish model', e);
				})
				.then(() => {
					document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url: '/'}}));
				});
		}],
		['[data-action="update"]', 'click', e => {
			const query = numericize(window.location.pathname.substring(1).split('/').reduce((a,v,i,arr)=>i%2===0&&arr[i+1]!==undefined?Object.assign(a, {[v]: arr[i+1]}):a, {}));
			const params = readForm(e.target.closest('.form'), query);
			const url = '/'+Object.keys(params).map(v=>[v, Array.isArray(params[v]) ? params[v].join(',') : (typeof params[v] === 'object' ? JSON.stringify(params[v]) : params[v])].join('/')).join('/');
			document.querySelector('.main').dispatchEvent(new CustomEvent('navigate', {detail: {url}}));
		}],
	]
});