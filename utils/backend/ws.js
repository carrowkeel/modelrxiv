
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const compress = (data) => {
	const gzip = require('zlib').gzipSync;
	const compressed = gzip(JSON.stringify(data));
	return compressed.toString('base64');
}

const decompress = base64 => {
	const gunzip = require('zlib').gunzipSync;
	const decompressed = gunzip(new Uint8Array(Buffer.from(base64, 'base64')));
	return JSON.parse(decompressed.toString());
};

const wsReceiveParts = (ws, request_id, parts = [], n = 0) => new Promise((resolve, reject) => {
	ws.on('message', e => {
		const message_data = JSON.parse(e.utf8Data);
		if (message_data.request_id !== request_id)
			return;
		parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length)
			resolve(parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join(''));
	});
});

const decodeMessage = async (ws, message_data, receiving) => {
	const compressed = message_data.parts > 1 && message_data.request_id ? await wsReceiveParts(ws, message_data.request_id, [[message_data.part, message_data.data]], receiving.push(message_data.request_id)) : message_data.data;
	const decompressed = message_data.compression === 'gzip' ? decompress(compressed) : compressed;
	return Object.assign(message_data, {data: decompressed});
};

const wsSend = async (ws, request, websocket_frame_limit = 30 * 1024, compression_threshold = 10 * 1024) => {
	const compression_type = JSON.stringify(request.data).length > compression_threshold ? 'gzip' : 'none';
	const compressed = compression_type === 'gzip' ? compress(request.data) : request.data;
	if (compressed.length > websocket_frame_limit) {
		const parts = Math.ceil(compressed.length / websocket_frame_limit);
		for (const part of range(0, parts))
			ws.sendUTF(JSON.stringify(Object.assign(request, {part, parts, compression: compression_type, data: compressed.slice(part * websocket_frame_limit, (part + 1) * websocket_frame_limit)})));
	} else
		ws.sendUTF(JSON.stringify(Object.assign(request, {compression: compression_type, data: compressed})));
};

const processRequest = (options, queue, request, request_id, user) => new Promise(async (resolve, reject) => {
	switch(options.mode) {
		case 'slurm':
			await require('fs/promises').writeFile(`${request_id}.request`, JSON.stringify(Object.assign(request, {credentials: options.credentials, request_id, user})));
			require('child_process').exec(`sbatch --time=01:00:00 --mem=1G --ntasks=${options.machine.capacity} --wrap="node init.js --threads=${options.machine.capacity} --request=${request_id}.request;"`, err => {
				if (err)
					return reject();
				return resolve();
			});
		case 'subprocess':
		default:
			return Promise.all(request.collection ? request.collection.map(batch => queue({framework: request.framework, sources: request.sources, fixed_params: request.fixed_params, variable_params: batch})) : [queue(request)]).then(result => {
				return resolve(result);
			});
	}
});

const wsConnectSend = (websocket_url, options, user, request_id, result, attempt=0, retries=3) => new Promise((resolve, reject) => {
	const params = new URLSearchParams({authorization: options.credentials.token, ...options.machine});
	const WebSocketClient = require('websocket').client;
	const ws = new WebSocketClient();
	ws.on('connectFailed', e => {
		console.log('WebSocket connection failed', e);
		if (attempt < retries)
			wsConnectSend(websocket_url, options, user, request_id, data, attempt + 1);
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
		wsSend(connection, {type: 'result', request_id: request_id, user, machine_id: options.machine.id}, result);
		connection.close();
		resolve();
	});
	ws.connect(`${websocket_url}/?${params.toString()}`);
});

const connectWebSocket = (container, url, receiving = []) => {
	const ws = new WebSocket(url);
	ws.addEventListener('open', e => {
		container.dispatchEvent(new Event('connected'));
	});
	ws.addEventListener('close', e => {
		container.dispatchEvent(new Event('disconnected'));
	});
	ws.addEventListener('error', error => {
		console.log(error);
		container.dispatchEvent(new CustomEvent('error', {detail: {error}}));
	});
	ws.addEventListener('message', async e => {
		const message_data = parseJSON(e.data);
		if (message_data.request_id && receiving.includes(message_data.request_id))
			return;
		const message = await decodeMessage(ws, message_data, receiving);
		container.dispatchEvent(new CustomEvent('message', {detail: {message}}));
	});
	return ws;
};

			try {
				const result = await processRequest(options, queue, request.data, request.request_id, request.user);
				return wsSend(connection, {type: 'result', request_id: request.request_id, user: request.user, machine_id: options.machine.id, data: result});
			} catch (e) {
				console.log(`Failed to process request ${request.request_id}`, e);
			}

const wsConnect = (module, websocket_url, options, receiving) => new Promise((resolve, reject) => {
	const WebSocketClient = require('websocket').client;
	const ws = new WebSocketClient();
	ws.on('connectFailed', e => {
		console.log('WebSocket connection failed', e);
		reject();
	});
	ws.on('connect', connection => {
		module.emit('connected', module);
		connection.on('close', () => {
			module.emit('disconnected', module);
		});
		connection.on('error', e => {
			console.log('WebSocket error', e);
			module.emit('disconnected', module);
		});
		connection.on('message', async message => {
			const message_data = JSON.parse(message.utf8Data);
			if (message_data.type !== 'request' || (message_data.request_id && receiving.includes(message_data.request_id)))
				return;
			const request = await decodeMessage(connection, message_data, receiving);
			container.dispatchEvent(new CustomEvent('message', {detail: {message}}));
		});
		connection.sendUTF(JSON.stringify({type: 'connected', data: options.machine}));
		resolve();
	});
	ws.connect(`${websocket_url}/?${params.toString()}`);
});

export const ws = (module, {options, local}, storage={receiving: [], status: 'disconnected'}) => ({
	hooks: [
		['init', () => {
			module.emit('connect');
		}],
		['connect', () => {
			if (storage.ws && storage.ws.readyState > 1)
				return; // Possibly check if status is "connecting"
			const params = new URLSearchParams({authorization: options.credentials.token, ...local});
			storage.status = 'connecting';
			storage.ws = wsConnect(module, `${options.url}/?${params.toString()}`);
		}],
		['connected', () => {
			storage.status = 'connected';
			module.emit('send', {type: 'connected', data: local});
		}],
		['disconnected', () => {
			if (storage.status === 'connected') // Check why it disconnected
				module.emit('connect', module);
			storage.status = 'disconnected';
		}],
		['send', data => {
			return wsSend(storage.ws, data);
		}],
		['message', e => {
			
		}],
	]
});

module.exports = { ws };