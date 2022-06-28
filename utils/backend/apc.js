
const parseJSON = (text, default_value={}) => {
	try {
		if (text === null)
			throw 'JSON string missing';
		return JSON.parse(text);
	} catch (e) {
		return default_value;
	}
};

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

const spawnWorker = (apc, options, file_cache, workers, i, request, stream) => new Promise(async resolve => {
	const exec = {'js': 'node worker.js', 'node.js': 'node worker.node.js', 'py': 'python3 worker.py', 'R': 'Rscript worker.R'}; // This is inconsistent, supposedly the frameworks are read from the directory but here they are hard-coded
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
		const messages = parts.slice(0, parts.length - 1).map(v => parseJSON(v, v));
		cache.length = 0;
		cache.push(parts[parts.length - 1]);
		for (const message of messages) {
			switch(message.type) {
				case 'dynamics':
					stream(message.data);
					break;
				case 'result':
					if (stream) {
						stream(message.data);
						stream(null);
					}
					resolve(message.data);
					break;
				default:
					console.log(message);
			}
		}
	});
	/*
	apc.on('message', message => { // Example implementation of termination signal
		if (message.type !== 'terminate' || message.request_id !== request.request_id)
			return;
		workers[i].kill();
	});
	*/
	const script = await loadSources(file_cache, options.public_url, request.sources, options.credentials);
	workers[i].stdin.write(JSON.stringify({type: 'job', request: Object.assign({}, request, {script: script.filename})})+'\n');
});

const workerQueue = (apc, options, workers=Array.from(new Array(options.threads)), queue=[], file_cache={}) => (request, stream) => {
	const deploy = (workers, thread) => spawnWorker(apc, options, file_cache, workers, thread, request, stream).then(result => {
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

const processRequest = (options, queue, request, request_id, user) => new Promise(async (resolve, reject) => {
	switch(options.mode) {
		case 'slurm':
			const exec = require('util').promisify(require('child_process').exec);
			await require('fs/promises').writeFile(`${request_id}.request`, JSON.stringify(Object.assign(request, {credentials: options.credentials, request_id, user})));
			await exec(`mkfifo ${request_id}.output`);
			exec(`sbatch --time=01:00:00 --mem=1G --ntasks=${options.machine.capacity} --wrap="node init.js --threads=${options.machine.capacity} --request=${request_id}.request;"`)
				.catch(reject)
				.then(() => {
					const output_stream = require('fs').createReadStream(`${request_id}.output`);
					const chunks = [];
					output_stream.on('data', data => {
						chunks.push(data.toString());
					});
					output_stream.on('close', () => {
						// TODO: Delete pipe file
						resolve(JSON.parse(chunks.join('')));
					});
				});
		case 'subprocess':
		default:
			switch(true) {
				case request.collection !== undefined:
					return Promise.all(request.collection.map(batch => {
						return queue({framework: request.framework, sources: request.sources, fixed_params: request.fixed_params, variable_params: batch});
					})).then(resolve);
				default:
					const {Readable} = require('stream');
					const dynamics_stream = new Readable({objectMode: true, read(chunk){}});
					queue(request, (data) => dynamics_stream.push(data)); // Would be better if this was async so that we can wait to push, either way to avoid data accumulating we would need to pause the process on the worker
					resolve(dynamics_stream);
			}
	}
});

const addResource = (apc, options, resources, resource, initial=false) => {
	if (!initial && (resource.machine_id === options.id))
		return;
	const current = Object.keys(resources).filter(connection_id => resources[connection_id].dataset.machine_id === resource.machine_id);
	if (current.length > 0)
		return current.forEach(connection_id => resources[connection_id].emit('wsconnected', resource.connection_id));
	resources[resource.connection_id] = require('./add_module').addModule('resource', {apc, resource, frameworks: resource.frameworks, machine_id: resource.machine_id, connection_id: resource.connection_id});
	resources[resource.connection_id].on('connectionstatechange', () => {
		if (resources[resource.connection_id].dataset.connectionState === 0)
			delete resources[resource.connection_id];
	});
	return resources[resource.connection_id];
};

const apc = (module, {options, request}, elem, storage={resources: {}}) => ({
	hooks: [
		['init', async () => {
			storage.local_queue = workerQueue(module, options);
			const local_resource = {machine_id: options.id, type: 'node', name: options.name, capacity: request ? 0 : options.threads, cost: 0, time: 100, frameworks: options.frameworks.join(',')};
			addResource(module, options, storage.resources, Object.assign({}, local_resource, {connection_id: 'local'}), true);
			if (request) {
				const results = await new Promise(resolve => module.emit('job', request, resolve));
				const output_stream = require('fs').createWriteStream(`${request_id}.output`);
				output_stream.write(JSON.stringify(results));
				output_stream.end();
			} else
				storage.ws = require('./add_module').addModule('ws', {apc: module, options, local: local_resource});
		}],
		['job', async (request, resolve) => {
			console.log(`Processing job ${request.request_id}`);
			processRequest(options, storage.local_queue, request.data, request.request_id, request.user)
				.catch(e => console.log(`Failed to process request ${request.request_id}`, e))
				.then(resolve)
				.then(() => console.log(`Finished job ${request.request_id}`));
		}],
		['send', data => {
			storage.ws.emit('send', data);
		}],
		['message', message => {
			switch(message.type) {
				case 'resources':
					return message.data.forEach(resource => addResource(module, options, storage.resources, resource));
				case 'connected':
					return addResource(module, options, storage.resources, message.data);
				case 'disconnected':
					if (storage.resources[message.connection_id] === undefined) {
						console.log(`Disconnected resource ${message.connection_id} does not exist`);
						console.log(storage.resources);
						return;
					}
					return storage.resources[message.connection_id].emit('wsdisconnected');
				default:
					if (storage.resources[message.user] === undefined) {
						console.log(`Resource ${message.user} does not exist`);
						console.log(message);
						console.log(storage.resources);
					}
					return storage.resources[message.user].emit('message', message);
			}
		}]
	]
});

module.exports = { apc };