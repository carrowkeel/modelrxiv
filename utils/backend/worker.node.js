'use strict';

// TODO: consider using child_process.fork for js scripts despite inconsistency with other languages (which will use stdout for messaging)

const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

async function* dynamicsStream (step_module, params) {
	const steps = Math.max(1, params.target_steps || 0);
	let step = undefined;
	for (const t of range(0, steps + 1)) {
		step = step_module.step(params, step, t);
		if (step === false)
			break;
		yield step;
	}
}

const runParams = async (step_module, fixed_params, variable_params, step_output=()=>{}) => {
	return variable_params ?
		variable_params.map(variable_params => {
			const params = Object.assign({}, fixed_params, variable_params);
			return step_module.run(params, step_output);
		})
	:
		step_module.run(fixed_params, step_output);
};

const test = async (step_module) => {
	try {
		const params = Object.assign({}, step_module.defaults());
		return {input_params: params, dynamics_params: step_module.step ? step_module.step(step_module.defaults(), undefined, 0) : {}, result_params: step_module.run(step_module.defaults())};
	} catch (e) {
		return {error: e};
	}
};

const processJob = async (request) => {
	const step_module = require(`./${request.script}`);
	switch(true) {
		case request.fixed_params.test:
			return test(step_module);
		case request.variable_params === undefined && step_module.step:
			const dynamics_stream = await dynamicsStream(step_module, request.fixed_params);
			while(true) {
				const step = await dynamics_stream.next();
				if (step.done)
					break;
				process.stdout.write(JSON.stringify({type: 'dynamics', data: step.value})+'\n');
			}
			return {};
		case request.variable_params === undefined:
			const step_output = (step) => process.stdout.write(JSON.stringify({type: 'dynamics', data: step})+'\n');
			return runParams(step_module, request.fixed_params, undefined, step_output);
		default:
			return runParams(step_module, request.fixed_params, request.variable_params);
	}
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
					process.stdout.write(JSON.stringify({type: 'result', data: result})+'\n');
					break;
			}
		}
	});
};

init();
