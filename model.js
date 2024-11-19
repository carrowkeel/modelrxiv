import { shortNotation, mathNotation, generateID, queryFromPath, replaceStrings, toCSV, errorBox, confirmBox } from '/apc/common.js';
import { parametersForm, readForm } from '/apc/form.js';
import { cacheString, getIDBObject } from '/apc/cache.js';
import { initializePlots, updatePlots } from '/apc/plot.js';
import { attachWorker } from '/apc/jobs.js';

const getCredentials = async (property) => {
	const credentials = await getIDBObject('apc', 'auth', 'credentials');
	return credentials[property];
};

const presetsText = (presets) => presets === undefined ? '' : presets.map(preset => `<div class="preset" data-type="${preset.analysis ? 'analysis' : 'dynamics'}"><a data-preset="${preset.label}" title="${preset.analysis ? 'Clicking this preset will run an analysis in your browser. To complete the analysis you will need to stay on this page. Note that analyses may take a few minutes to complete.' : Object.entries(preset).map(([param, value]) => `${param}=${value}`).join('\n')}">${preset.label}</a></div>`).join('');

export const defaultsFromScheme = (scheme) => {
	return scheme.parameter ? Object.fromEntries(scheme.parameter.map(parameter => [parameter.name, parameter.value || parameter.default])) : {};
};

export const parseModelScheme = (model_id, scheme) => {
	const lines = scheme.trim().split('\n');
	const metadata = {model_id};
	const cache = [];
	lines.forEach(_line => {
		const line = _line.trim();
		const match = line.match(/^#+\s*(plot|parameter|preset|metadata|analysis)[:\s]*(.*)/i);
		if (match) {
			const [_, section_type, section_label] = match;
			const type = section_type.toLowerCase();
			const label = section_label.trim();
			if (cache.length !== 0) {
				const current_section = cache.pop();
				if (current_section.type === 'metadata')
					Object.assign(metadata, current_section.attributes);
				else {
					if (metadata[current_section.type] === undefined)
						metadata[current_section.type] = [];
					metadata[current_section.type].push(current_section.attributes);
				}
			}
			cache.push({type, attributes: {label}});
		} else if (line.includes('=')) {
			const [key, value] = line.split('=', 2);
			if (cache.length !== 0)
				cache[0].attributes[key.trim()] = value.trim();
		}
	});
	if (cache.length !== 0) {
		const current_section = cache.pop();
		if (current_section.type === 'metadata') {
			Object.assign(metadata, current_section.attributes);
		} else {
			if (metadata[current_section.type] === undefined)
				metadata[current_section.type] = [];
			metadata[current_section.type].push(current_section.attributes);
		}
	}
	return metadata;
};

const dynamicsScript = async (params, framework='py') => { // Store statically
	switch(framework) {
		case 'py':
			const module_script = await fetch(params.script_uri).then(res => res.text());
			return `${module_script}

async def run(params):
	last_step = None
	t = 0
	while True:
		last_step = step(params, last_step, t)
		if last_step == False:
			break
		message({'type': 'stream', 'data': {**last_step, 't': t}})
		t = await increment_step(t)
		if t == False:
			break
	message({'type': 'stream', 'data': False})
`;
		case 'js':
			return `export const run = async (params) => {
	const step_module = await import(params.script_uri);
	let last_step = null;
	let t = 0;
	while(true) {
		last_step = step_module.step(params, last_step, t);
		if (last_step === false)
			break;
		self.message({type: 'stream', data: Object.assign({}, last_step, {t})});
		t = await self.increment_step(t);
		if (t === false)
			break;
	}
	self.message({type: 'stream', data: false});
};
`;
	}
};

const generatePlot = (model_elem, scheme, preset) => new Promise(async resolve => {
	const analysis = scheme.analysis.find(analysis => analysis.label === preset.analysis);
	if (!analysis)
		throw 'Analysis not defined in scheme';
	const request_id = await generateID(8);
	const params = Object.assign(defaultsFromScheme(scheme), readForm(model_elem.querySelector('[data-content="parameters"]')), {script_uri: scheme.script_uri});
	const handler = async (e) => {
		const request = e.detail;
		if (request.request_id !== request_id || request.type !== 'result')
			return;
		const result = request.data;
		const plots = formatPlots([Object.assign({}, analysis, {label: `${preset.label} (${generateID(4)})`, save: 'analysis'})], scheme.parameter);
		initializePlots(model_elem.querySelector('.plots'), plots);
		updatePlots(model_elem.querySelector('.plots'), plots, result, false);
		resolve();
	};
	const handle_error = e => {
		console.log(e);
		errorBox('Failed to generate model results', 'An error was encountered while generating your results');
		resolve();
	};
	model_elem.addEventListener('worker_response', handler);
	model_elem.addEventListener('worker_error', handle_error);
	model_elem.dispatchEvent(new CustomEvent('deploy', {detail: {request_id, script_uri: scheme.script_uri, function_name: analysis.function, libraries: scheme.libraries, framework: scheme.framework || 'py', params: parseNumeric(params)}}));
});

const runDynamics = async (model_elem, scheme, request_id, params) => {
	const steps = [];
	const cache_output = [];
	if (!scheme.plot)
		return;
	const plots = formatPlots(scheme.plot, scheme.parameter, params);
	const increment_step = t => {
		model_elem.dispatchEvent(new CustomEvent('worker_message', {detail: {type: 'step', request_id, step: t}}));
	};
	let t = 0;
	const handler = async (e) => {
		const request = e.detail;
		if (request.request_id !== request_id || request.type !== 'stream')
			return;
		const step_data = request.data;
		if (model_elem.dataset.instance !== request_id) {
			model_elem.removeEventListener('message', handler);
			return;
		}
		if (!step_data) {
			model_elem.removeEventListener('message', handler);
			model_elem.dispatchEvent(new Event('complete'));
			cacheString(`/dynamics/${request_id}.json`, JSON.stringify(cache_output));
			return;
		}
		steps.push(step_data);
		cache_output.push(Object.fromEntries(Object.entries(step_data).filter(([key, value]) => typeof value === 'string' || typeof value === 'number')));
		if (steps.length > 2)
			steps.shift();
		model_elem.dispatchEvent(new Event('data'));
		try {
			updatePlots(model_elem, plots, steps, t === 0);
		} catch (e) {
			model_elem.dispatchEvent(new CustomEvent('error', {detail: {error: `Failed to update plots: ${e}`}}));
			return;
		}
		if (model_elem.classList.contains('paused')) {
			await new Promise(resolve => {
				model_elem.addEventListener('run', e => resolve(), {once: true});
			});
		}
		await new Promise(resolve => setTimeout(resolve, 10));
		increment_step(t >= (params['step_num'] || 100) ? false : ++t);
	};
	const handle_error = e => {
		const response = e.detail;
		const error = response.error;
		model_elem.dispatchEvent(new Event('data'));
		model_elem.dispatchEvent(new Event('complete'));
	};
	model_elem.addEventListener('worker_response', handler);
	model_elem.addEventListener('worker_error', handle_error);
	const script = await dynamicsScript(params, scheme.framework);
	model_elem.dispatchEvent(new CustomEvent('deploy', {detail: {request_id, script, libraries: scheme.libraries, framework: scheme.framework || 'py', params}}));
};

const parseNumeric = params => Object.fromEntries(Object.entries(params).map(([name, value]) => !isNaN(value) ? [name, +(value)] : [name, value]));

const hooks = scheme => [
	['*', 'run', async e => {
		if (e.target.classList.contains('running'))
			return e.target.classList.toggle('paused');
		e.target.classList.add('running');
		const params = Object.assign(defaultsFromScheme(scheme), readForm(e.target.querySelector('[data-content="parameters"]')), {script_uri: scheme.script_uri});
		const request_id = await generateID(8);
		e.target.dataset.instance = request_id;
		e.target.dispatchEvent(new Event('loading'));
		runDynamics(e.target, scheme, request_id, parseNumeric(params));
	}],
	['*', 'complete', e => {
		e.target.classList.remove('running');
	}],
	['*', 'loading', e => {
		const plots = e.target.querySelector('.plots');
		plots.classList.add('loading');
		const div = document.createElement('div');
		div.classList.add('overlay');
		div.innerHTML = 'Loading libraries...';
		plots.appendChild(div);
	}],
	['*', 'data', e => {
		if (!e.target.querySelector('.plots .overlay'))
			return;
		e.target.querySelector('.plots').classList.remove('loading');
		e.target.querySelector('.plots .overlay').remove();
	}],
	['[data-action="start"]', 'click', e => {
		e.target.closest('[data-module="model"]').dispatchEvent(new Event('run'));
	}],
	['[data-action="restart"]', 'click', e => {
		e.target.closest('[data-module="model"]').classList.remove('running');
		e.target.closest('[data-module="model"]').dispatchEvent(new Event('run'));
	}],
	['[data-action="export"]', 'click', async e => {
		// Determine if analysis or dynamics
		const plot = e.target.closest('[data-plot]');
		if (plot.dataset.save === 'analysis') {
			const image_link = document.createElement('a');
			image_link.href = plot.querySelector('canvas').toDataURL('image/png');
			image_link.download = 'analysis_result.png'; // Use label
			document.body.appendChild(image_link);
			image_link.click();
			document.body.removeChild(image_link);
			return;
		}
		const instance = e.target.closest('[data-module="model"]').dataset.instance;
		if (!instance)
			throw 'Run dynamics before exporting data';
		const data = await fetch(`/dynamics/${instance}.json`).then(res => res.json());
		toCSV('dynamics.csv', data);
	}],
	['[data-action="edit"]', 'click', async e => {
		window.location.href = `/edit/${scheme.model_id}`;
	}],
	['[data-action="copy"]', 'click', async e => {
		if (await confirmBox('Copy model', 'Are you sure you want to create a copy of this model?') !== 1)
			return;
		document.body.classList.add('loading');
		try {
			const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'copy', model_id: scheme.model_id, framework: scheme.framework})});
			if (!res.ok)
				throw 'Request failed';
			const response_data = await res.json();
			window.location.href = `/sandbox/${response_data.model_id}`;
		} catch (e) {
			document.body.classList.remove('loading');
			errorBox('Failed to copy model', 'An error was encountered while attempting to copy the model');
		}
	}],
	['[data-action="publish"]', 'click', async e => {
		if (await confirmBox('Publish model', 'This will submit your model to modelRxiv for review before being displaying publicly. Make sure your code is compliant with modelRxiv and works as expected before publishing. By clicking "Confirm", you declare that all model content (including the code and text details) can be publicly displayed on modelRxiv.') !== 1)
			return;
		document.body.classList.add('loading');
		try {
			const res = await fetch(`https://d.modelrxiv.org/submit_beta`, {method: 'POST', headers: {Authorization: `Basic ${await getCredentials('token')}`}, body: JSON.stringify({action: 'publish', model_id: scheme.model_id, framework: scheme.framework})});
			if (!res.ok)
				throw 'Request failed';
			document.body.classList.remove('loading');
			errorBox('Successfully submitted model', 'Your model will now be manually screened to assure that your code is compliant');
		} catch (e) {
			document.body.classList.remove('loading');
			errorBox('Failed to publish model', 'An error was encountered submitting the model');
		}
	}],
	['[data-action="parameters-menu"]', 'click', e => {
		e.target.closest('[data-module="model"]').querySelector('.parameters-menu').classList.toggle('show');
	}],
	['[data-preset]', 'click', async e => {
		if (e.target.parentElement.classList.contains('running'))
			return;
		const model_elem = e.target.closest('[data-module="model"]');
		const preset = scheme.preset.find(preset => preset.label === e.target.dataset.preset);
		Object.entries(preset).forEach(([param, value]) => model_elem.querySelector(`.parameters-menu [name="${param}"]`) ? model_elem.querySelector(`.parameters-menu [name="${param}"]`).value = value : 0);
		if (preset.analysis) {
			e.target.parentElement.classList.add('running');
			await generatePlot(model_elem, scheme, preset);
			e.target.parentElement.classList.remove('running');
		} else
			model_elem.dispatchEvent(new Event('run'));
	}]
];

const parseAxisLimits = (notation, plot_axis, scheme_parameters, user_parameters, default_value=[0, 1]) => {
	if (notation) {
		const parts = notation.replace(/[\[\]]+/g, '').split(',').map(part => {
			if (!isNaN(part))
				return +(part);
			if (user_parameters && user_parameters[part])
				return user_parameters[part];
			const axis_parameter = scheme_parameters.find(param => part === param.name || (part === 't' && param.name === 'step_num'));
			if (axis_parameter)
				return axis_parameter.value;
		});
		return parts;
	}
	return default_value;
};

const formatPlots = (plots, scheme_parameters, user_parameters) => {
	return plots.map(plot => {
		const xlim = parseAxisLimits(plot.xlim, plot.x, scheme_parameters, user_parameters, [0, 100]);
		const ylim = parseAxisLimits(plot.ylim, plot.y, scheme_parameters, user_parameters, [0, 1]);
		return Object.assign({}, plot, {xlim, ylim});
	});
};

export const init = async (container, query_path=window.location.pathname) => {
	const query = queryFromPath(query_path);
	const model_id = query.code || query.sandbox || query.model;
	const scheme = await fetch(`/${query.sandbox ? `user/${model_id}` : `models/${model_id}`}.txt`).then(res => res.text()).then(text => parseModelScheme(model_id, text));
	if (!scheme.parameter)
		throw 'Could not find any parameters in the model scheme. Check that the parameters were correctly formatted.';
	const framework = scheme.framework || 'py';
	if (query.code)
		scheme.code = await fetch(`/models/${model_id}.${framework}`).then(res => res.text());
	scheme.script_uri = query.sandbox ? `/user/${model_id}.${framework}` : `/models/${model_id}.${framework}`;
	replaceStrings(Object.assign({}, scheme, {presets: presetsText(scheme.preset), parameters: parametersForm(scheme.parameter)}));
	container.querySelectorAll('.shorten').forEach(elem => {
		const text = elem.innerHTML;
		if (text.length < 200)
			return;
		const shortened = text.substring(0, 150);
		elem.innerHTML = `<div class="short">${shortened}... <a data-action="more">Read more</a></div><div class="long">${text} <a data-action="more">Read less</a></div>`;
	});
	if (!scheme.preset || scheme.preset.length === 0)
		container.querySelector('[data-tab="parameters"]')?.click();
	container.querySelectorAll('.model-link').forEach(elem => elem.setAttribute('href', `/model/${model_id}`));
	container.querySelectorAll('.code-link').forEach(elem => elem.setAttribute('href', `/code/${model_id}`));
	addHooks(container, hooks(scheme));
	if (query.code)
		return;
	if (scheme.plot)
		initializePlots(container.querySelector('.plots'), formatPlots(scheme.plot, scheme.parameter));
	attachWorker(container);
};
