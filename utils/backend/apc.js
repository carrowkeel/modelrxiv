
const signedURL = (url, signature, query = {}) => {
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

const scriptFromSources = (sources, credentials, public_url) => { // Will support multiple sources, but currently only using the first as the script file
	const script_source = sources[0];
	const filename = `${['script', credentials.user_id, script_source.model_id].join('_')}.${script_source.framework === 'js' ? 'mjs' : script_source.framework}`;
	const url = public_url + (script_source.private ? signedURL(`/users/${credentials.user_id}/${script_source.model_id}.${script_source.framework}`, credentials.cdn) : `/models/${script_source.model_id}.${script_source.framework}`);
	return {id: script_source.model_id, url, filename, framework: script_source.framework};
};

const readURL = url => new Promise((resolve, reject) => {
	const req = require('https').request(url, res => {
		const chunks = [];
		res.on('data', chunk => {
			chunks.push(chunk.toString());
		});
		res.on('end', () => {
			resolve(chunks.join(''));
		});
	});
	req.on('error', () => {
		reject();
	});
	req.end();
});

const loadSources = (file_cache, public_url, sources, credentials) => {
	const script = scriptFromSources(sources, credentials, public_url);
	if (file_cache[script.id] === undefined) {
		file_cache[script.id] = new Promise(async (resolve, reject) => {
			const file_data = await readURL(script.url);
			await require('fs/promises').writeFile(script.filename, file_data);
			resolve(script);
		});
	}
	return file_cache[script.id];
};

const spawnWorker = (options, file_cache, workers, i, request) => new Promise(async resolve => {
	const exec = {'js': 'node worker.js', 'py': 'python3 worker.py', 'R': 'Rscript worker.R'};
	const cache = [];
	if (workers[i] === undefined) {
		workers[i] = require('child_process').exec(exec[request.framework], {maxBuffer: 10 * 1024 * 1024});
		workers[i].on('error', e => console.log(e.toString()));
		workers[i].stderr.on('data', e => console.log(e.toString()));
	}
	workers[i].stdout.on('data', async data => {
		const chunk = data.toString();
		cache.push(chunk);
		const parts = cache.join('').split('\n');
		if (parts.length === 1)
			return;
		const message = JSON.parse(parts[0]);
		cache.length = 0;
		cache.push(parts[1]);
		if (message.type === 'result') {
			resolve(message.result);
		}
	});
	const script = await loadSources(file_cache, options.public_url, request.sources, options.credentials);
	workers[i].stdin.write(JSON.stringify({type: 'job', request: Object.assign({}, request, {script: script.filename})})+'\n');
});

const workerQueue = (options, workers=Array.from(new Array(options.threads)), queue=[], file_cache={}) => (data) => {
	const deploy = (workers, thread) => spawnWorker(options, file_cache, workers, thread, data).then(result => {
		if (queue.length > 0) {
			const {r, d} = queue.shift();
			r(d(workers, thread));
		} else {
			workers[thread].kill();
			workers[thread] = undefined;
		}
		return result;
	});
	const i = workers.indexOf(undefined);
	if (i === -1) {
		return new Promise(r => {
			queue.push({r, d: deploy});
		});
	}
	return deploy(workers, i);
};

const addResource = (apc, resources, resource) => {
	Object.keys(resources).filter(connection_id => resources[connection_id].machine_id === resource.machine_id).forEach(connection_id => delete resources[connection_id]);
	resources[resource.connection_id] = require('./add_module').addModule('resource', {apc, resource, frameworks: resource.frameworks, machine_id: resource.machine_id, connection_id: resource.connection_id});
	return resources[resource.connection_id];
};

const apc = (module, {options, request}, elem, storage={resources: {}}) => ({
	events: [
		['init', () => {
			options.id = getID();
			storage.queue = workerQueue(options);
			storage.local_queue = workerQueue(elem, options);
			const local_resource = {machine_id: options.id, type: 'node', name: options.name, capacity: request ? 0 : threads, cost: 0, time: 100, frameworks: options.frameworks.join(',')};
			addResource(module, storage.resources, Object.assign({}, local_resource, {connection_id: 'local'}));
			if (request) {
				// run job and connect to send results, think how to combine with rtc which requires a longer connection process
				// await processRequest(options, queue, request).then(result => require('./ws').wsConnectSend(websocket_url, options, request.user, request.request_id, result));
			}
			storage.ws = require('./add_module').addModule('ws', {options});
		}],
		['job', (request, resolve) => {
			Promise.all(request.data.collection.map(batch => storage.local_queue({framework: request.data.framework, sources: request.data.sources, fixed_params: request.data.fixed_params, variable_params: batch}))).then(resolve);
		}],
		['ws', message => {
			switch(message.type) {
				case 'resources':
					return message.data.forEach(resource => addResource(storage.resources, resource));
				case 'connected':
					return addResource(storage.resources, message.data);
				case 'disconnected':
					delete storage.resources[message.connection_id];
					break;
				default:
					return storage.resources[message.user].emit('message', message);
			}
		}]
	]
});

module.exports = { apc };