
importScripts('/pyodide/pyodide.js');
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const signedURL = (url, signature, query = {}) => {
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

/*
const pythonModuleWrapper = async (module, reload=false) => ({
	module: await fetch(module.module_url, {cache: reload ? 'no-cache' : 'default'}).then(res => res.text()),
	pyodide: await (async () => {
		try {
			if (typeof loadPyodide !== 'function')
				await loadScript('/pyodide/pyodide.js');
			const pyodide = await loadPyodide({indexURL: 'https://modelrxiv.org/pyodide/'});
			await pyodide.loadPackage('numpy'); // Fix
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
*/

const pythonModuleWrapper = async (module_url, reload=false) => ({
	module: await fetch(module_url, {cache: reload ? 'no-cache' : 'default'}).then(res => res.text()),
	pyodide: await (async () => {
		try {
			const pyodide = await loadPyodide({indexURL: 'https://modelrxiv.org/pyodide/'});
			await pyodide.loadPackage('numpy'); // NumPy loaded by default, implement module definition in model builder
			return pyodide;
		} catch (e) {
			return pyodide;
		}
	})(),
	defaults: function () {
		const code = `${this.module}
result = defaults()
`;
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('result');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	},
	step: function (params, _step, t) {
		const code = `${this.module}
result = step(params, _step, ${t})
`;
		this.pyodide.globals.set('params', this.pyodide.toPy(params));
		this.pyodide.globals.set('_step', this.pyodide.toPy(_step));
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('result');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	},
	run: function (params) {
		const code = `${this.module}
result = run(params)
`;
		this.pyodide.globals.set('params', this.pyodide.toPy(params));
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('result');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	}
});

const scriptWrapper = (script, framework) => {
	switch(framework) {
		case 'py':
			return pythonModuleWrapper(script);
		case 'js':
		default:
			return import(script);
	}
};

const scriptFromSources = (sources, credentials) => {
	const script_source = sources[0];
	const script_url = script_source.private ? signedURL(`/users/${credentials.user_id}/${script_source.model_id}.${script_source.framework}`, credentials.cdn) : `/models/${script_source.model_id}.${script_source.framework}`;
	return script_url;
};

function* dynamicsStream (script, framework, params) {
	const step_module = await scriptWrapper(script, framework);
	const steps = Math.max(1, params.target_steps || 0);
	let step = null;
	for (const t of range(0, steps)) {
		step = step_module.step(params, step, t);
		if (step === false)
			break;
		yield step;
	}
}

const runParams = async (script, framework, fixed_params, variable_params) => {
	const step_module = await scriptWrapper(script, framework);
	return variable_params.map(variable_params => {
		const params = Object.assign({}, fixed_params, variable_params);
		return step_module.run(params);
	});
};

const test = async (script, framework) => {
	try {
		const step_module = await scriptWrapper(script, framework);
		const params = Object.assign({}, step_module.defaults());
		return {input_params: params, dynamics_params: step_module.step ? step_module.step(step_module.defaults(), undefined, 0) : {}, result_params: step_module.run(step_module.defaults())};
	} catch (e) {
		return {error: e};
	}
};

self.addEventListener("message", async e => {
	const request = e.data;
	const script = scriptFromSources(request.sources, request.credentials);
	switch(true) {
		case request.fixed_params.test:
			return test(script, request.framework).then(result => self.postMessage({type: 'result', data: result}));
		case request.variable_params === undefined:
			const dynamics_stream = dynamicsStream(script, request.framework, request.fixed_params);
			while(true) {
				const step = dynamics_stream.next();
				if (step.done)
					break;
				self.postMessage({type: 'dynamics', data: step});
			}
			return self.postMessage({type: 'result', data: {}}); // Deriving a result here depends on step_module.result
		default:
			return runParams(script, request.framework, request.fixed_params, request.variable_params).then(result => self.postMessage({type: 'result', data: result));
	}
});
