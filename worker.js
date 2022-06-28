
importScripts('/pyodide/pyodide.js');
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const signedURL = (url, signature, query = {}) => {
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

const pythonModuleWrapper = async (module_url, reload=false) => ({
	module: await fetch(module_url, {cache: reload ? 'no-cache' : 'default'}).then(res => res.text()),
	pyodide: await (async () => {
		try {
			const pyodide = await loadPyodide({indexURL: 'https://modelrxiv.org/pyodide/'});
			await pyodide.loadPackage('numpy'); // NumPy loaded by default, implement module definition in model builder
			await pyodide.loadPackage('matplotlib');
			return pyodide;
		} catch (e) {
			return pyodide;
		}
	})(),
	defaults: function () {
		const code = `${this.module}
output = defaults()
`;
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('output');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	},
	has_step: function() {
		return this.module.match(/def step[ ]*\(/);
	},
	step: function (params, _step, t) {
		const code = `${this.module}
output = step(params, _step, ${t})
`;
		this.pyodide.globals.set('params', this.pyodide.toPy(params));
		this.pyodide.globals.set('_step', this.pyodide.toPy(_step));
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('output');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	},
	run: function (params) {
		console.log(params);
		const code = `${this.module}
output = run(params)
`;
		this.pyodide.globals.set('params', this.pyodide.toPy(params));
		this.pyodide.runPython(code);
		const outputPr = this.pyodide.globals.get('output');
		const result = outputPr.toJs();
		outputPr.destroy();
		return result instanceof Map ? Object.fromEntries(result) : result;
	}
});

const scriptWrapper = (script, framework) => {
	switch(framework) {
		case 'py':
			return pythonModuleWrapper(script);
		default:
			return import(script);
	}
};

const scriptFromSources = (sources, credentials) => {
	const script_source = sources[0];
	const script_url = script_source.private ? signedURL(`/users/${credentials.user_id}/${script_source.model_id}.${script_source.framework}`, credentials.cdn) : `/models/${script_source.model_id}.${script_source.framework}`;
	return script_url;
};

async function* dynamicsStream (script, framework, params) {
	const step_module = await scriptWrapper(script, framework);
	const steps = Math.max(1, params.target_steps || 0);
	let step = undefined;
	for (const t of range(0, steps + 1)) {
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
		return {input_params: params, dynamics_params: (step_module.has_step === undefined && step_module.step) || step_module.has_step() ? step_module.step(step_module.defaults(), undefined, 0) : {}, result_params: step_module.run(step_module.defaults())};
	} catch (e) {
		return {error: e};
	}
};

self.addEventListener("message", async e => {
	const request = e.data;
	const script = scriptFromSources(request.sources, request.credentials);
	switch(true) {
		case request.fixed_params.test !== undefined:
			return test(script, request.framework).then(result => self.postMessage({type: 'result', data: result}));
		case request.variable_params === undefined: // && ((step_module.has_step === undefined && step_module.step) || step_module.has_step()):
			const dynamics_stream = await dynamicsStream(script, request.framework, request.fixed_params);
			while(true) {
				const step = await dynamics_stream.next();
				if (step.done)
					break;
				self.postMessage({type: 'dynamics', data: step.value});
			}
			return self.postMessage({type: 'result', data: {}}); // Deriving a result here depends on step_module.result
		case request.variable_params === undefined:
			const step_output = (step) => process.stdout.write(JSON.stringify({type: 'dynamics', data: step})+'\n');
			return runParams(step_module, request.fixed_params, undefined, step_output);
		default:
			return runParams(script, request.framework, request.fixed_params, request.variable_params).then(result => self.postMessage({type: 'result', data: result}));
	}
});
