'use strict';

const runParams = async (script, fixed_params, variable_params) => {
	const step_module = await import(`./${script}`);
	return variable_params.map(variable_params => {
		const params = Object.assign({}, fixed_params, variable_params);
		return step_module.run(params);
	});
};

const test = async (script) => {
	try {
		const step_module = await import(`./${script}`);
		const params = Object.assign({}, step_module.defaults());
		return {input_params: params, dynamics_params: step_module.step ? step_module.step(step_module.defaults(), undefined, 0) : {}, result_params: step_module.run(step_module.defaults())};
	} catch (e) {
		return {error: e};
	}
};

const processJob = (request) => {
	return request.fixed_params.test ? test(request.script) : runParams(request.script, request.fixed_params, request.variable_params);
};

const init = () => {
	const cache = [];
	process.stdin.on('data', async data => {
		const chunk = data.toString();
		const parts = chunk.split('\n');
		cache.push(parts[0]);
		if (parts.length === 1)
			return;
		else {
			const message = JSON.parse(cache.join(''));
			cache.length = 0;
			cache.push(parts[1]);
			switch(message.type) {
				case 'job':
					const result = await processJob(message.request);
					process.stdout.write(JSON.stringify({type: 'result', result})+'\n');
					break;
			}
		}
	});
};

init();
