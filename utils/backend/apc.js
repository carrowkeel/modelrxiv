const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const frameworksFromDir = dir => {
	return require('fs/promises').readdir(dir).then(files => {
		return files.filter(file => file.startsWith('worker.')).map(file => file.replace('worker.', ''));
	});
};

const signedURL = (url, signature, query = {}) => {
	if (!signature)
		return url;
	const qs = new URLSearchParams(Object.assign({}, query, signature));
	return `${url}?${qs.toString()}`;
};

const scriptFromSources = (sources, credentials, public_url) => { // Will support multiple sources, but currently only using the first as the script file
	const script_source = sources[0];
	const filename = `${['script', credentials.user_id, script_source.model_id].join('_')}.${script_source.framework === 'js' ? '.mjs' : script_source.framework}`;
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

const decodeWS = base64 => {
	const gunzip = require('zlib').gunzipSync;
	const decompressed = gunzip(new Uint8Array(Buffer.from(base64, 'base64')));
	return JSON.parse(decompressed.toString());
};

const wsSendParts = (ws, request, data, limit = 30 * 1024) => {
	const gzip = require('zlib').gzipSync;
	const compressed = gzip(JSON.stringify(data));
	const base64 = compressed.toString('base64');
	if (base64.length > limit) {
		const parts = Math.ceil(base64.length / limit);
		for (const part of range(0, parts))
			ws.sendUTF(JSON.stringify({...request, part, parts, data: base64.slice(part * limit, (part + 1) * limit)}));
	} else
		ws.sendUTF(JSON.stringify({...request, data: base64}));
};

const wsReceiveParts = (ws, type, request_id, parts = []) => new Promise((resolve, reject) => {
	ws.on('message', e => {
		const data = JSON.parse(e.utf8Data);
		if (data.type !== type || data.request_id !== request_id)
			return;
		if (data.parts)
			parts.push([data.part, data.data]);
		if (data.parts === parts.length) {
			const combined = parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join('');
			const result = decodeWS(combined);
			resolve(result);
		} else if (!data.parts) {
			const result = decodeWS(data.data);
			resolve(result);
		}
	});
});

const processRequest = (options, queue, request, request_id, connection_id) => new Promise(async (resolve, reject) => {
	switch(options.mode) {
		case 'slurm':
			await require('fs/promises').writeFile(`${request_id}.request`, JSON.stringify(Object.assign(request, {credentials: options.credentials, request_id, connection_id})));
			require('child_process').exec(`sbatch --time=01:00:00 --mem=1G --ntasks=${options.machine.capacity} --wrap="node init.js --threads=${options.machine.capacity} --request=${request_id}.request;"`, err => {
				if (err)
					return reject();
				return resolve();
			});
		case 'subprocess':
		default:
			Promise.all(request.collection ? request.collection.map(batch => queue({framework: request.framework, sources: request.sources, fixed_params: request.fixed_params, variable_params: batch})) : [options.queue(request)]).then(result => {
				return resolve(result);
			});
	}
});

const sendWS = (websocket_url, options, connection_id, request_id, result, attempt=0, retries=3) => new Promise((resolve, reject) => {
	const params = new URLSearchParams({authorization: options.credentials.token, ...options.machine});
	const WebSocketClient = require('websocket').client;
	const ws = new WebSocketClient();
	ws.on('connectFailed', e => {
		console.log('WebSocket connection failed', e);
		if (attempt < retries)
			sendWS(websocket_url, options, connection_id, request_id, data, attempt + 1);
		else {
			require('fs/promises').writeFile(`${request_id}.result`, JSON.stringify(result));
			reject();
		}
	});
	ws.on('connect', connection => {
		connection.on('close', () => {
			console.log('Websocket disconnected');
		});
		connection.on('error', e => {
			console.log('WebSocket error', e);
			require('fs/promises').writeFile(`${request_id}.result`, JSON.stringify(result));
		});
		wsSendParts(connection, {type: 'result', request_id: request_id, connection_id, machine_id: options.machine.id}, result);
		connection.close();
		resolve();
	});
	ws.connect(`${websocket_url}/?${params.toString()}`);
});

const connectWS = (websocket_url, options, queue, receiving, attempt=0, retries=3) => new Promise((resolve, reject) => {
	const params = new URLSearchParams({authorization: options.credentials.token, ...options.machine});
	const WebSocketClient = require('websocket').client;
	const ws = new WebSocketClient();
	ws.on('connectFailed', e => {
		console.log('WebSocket connection failed', e);
		reject();
	});
	ws.on('connect', connection => {
		console.log('WebSocket connected');
		connection.on('close', () => {
			console.log('WebSocket disconnected');
			connectWS(websocket_url, options, queue, receiving);
		});
		connection.on('error', e => {
			console.log('WebSocket error', e);
			if (attempt < retries)
				connectWS(websocket_url, options, queue, receiving, attempt + 1);
		});
		connection.on('message', async message => {
			const data = JSON.parse(message.utf8Data);
			switch(data.type) {
				case 'request':
					if (receiving.includes(data.request_id))
						return;
					receiving.push(data.request_id);
					console.log(`Processing request ${data.request_id}`);
					const request = data.parts && data.parts > 1 ? await wsReceiveParts(connection, 'request', data.request_id, [[data.part, data.data]]) : decodeWS(data.data);
					try {
						const result = await processRequest(options, queue, request, data.request_id, data.connection_id);
						console.log(`Finished processing request ${data.request_id}`);
						if (result)
							return wsSendParts(connection, {type: 'result', request_id: data.request_id, connection_id: data.connection_id, machine_id: options.machine.id}, result);
					} catch (e) {
						console.log(`Failed to process request ${data.request_id}`, e);
					}
					break;
			}
		});
		connection.sendUTF(JSON.stringify({type: 'connected', pool: options.machine}));
		resolve();
	});
	ws.connect(`${websocket_url}/?${params.toString()}`);
});

const init = async (websocket_url, id, credentials, threads=4, name='node', mode='subprocess', request_file='') => {
	const receiving = [];
	const frameworks = await frameworksFromDir('.');
	if (request_file !== '') {
		const machine = {machine_id: id, type: 'node', name, capacity: 0, cost: 0, time: 100, frameworks: ''};
		const request = await require('fs/promises').readFile(request_file).then(data => JSON.parse(data.toString()));
		const options = {credentials: request.credentials, threads, machine, public_url: 'https://modelrxiv.org'};
		const queue = workerQueue(options);
		await processRequest(options, queue, request).then(result => sendWS(websocket_url, options, request.connection_id, request.request_id, result));
	} else {
		const machine = {machine_id: id, type: 'node', name, capacity: threads, cost: 0, time: 100, frameworks: frameworks.join(',')};
		const options = {credentials, threads, machine, mode, public_url: 'https://modelrxiv.org'};
		const queue = workerQueue(options);
		return connectWS(websocket_url, options, queue, receiving);
	}
};

module.exports = { init };