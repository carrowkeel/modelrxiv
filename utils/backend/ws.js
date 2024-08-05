
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
	const handle_part = e => {
		const message_data = JSON.parse(e.utf8Data);
		if (message_data.request_id !== request_id)
			return;
		parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length) {
			ws.off('message', handle_part);
			resolve(parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join(''));
		}
	};
	ws.on('message', handle_part);
});

const decodeMessage = async (ws, message_data, receiving) => {
	const compressed = message_data.parts > 1 && message_data.request_id ? await wsReceiveParts(ws, message_data.request_id, [[message_data.part, message_data.data]], receiving.push(message_data.request_id)) : message_data.data;
	const decompressed = message_data.compression === 'gzip' ? decompress(compressed) : compressed;
	return Object.assign(message_data, {data: decompressed});
};

const wsSend = async (ws, request, websocket_frame_limit = 30 * 1024, compression_threshold = 10 * 1024) => {
	if (request.data.constructor.name === 'Readable') // For the moment, do not transmit stream data via websocket (an alternative is to turn the stream into chunks)
		throw 'Attempting to transmit stream via WebSocket';
	const compression_type = JSON.stringify(request.data).length > compression_threshold ? 'gzip' : 'none';
	const compressed = compression_type === 'gzip' ? compress(request.data) : request.data;
	if (compressed.length > websocket_frame_limit) {
		const parts = Math.ceil(compressed.length / websocket_frame_limit);
		for (const part of range(0, parts))
			ws.sendUTF(JSON.stringify(Object.assign(request, {part, parts, compression: compression_type, data: compressed.slice(part * websocket_frame_limit, (part + 1) * websocket_frame_limit)})));
	} else
		ws.sendUTF(JSON.stringify(Object.assign(request, {compression: compression_type, data: compressed})));
};

const wsConnect = (module, websocket_url, options, receiving=[]) => {
	const WebSocketClient = require('websocket').client;
	const ws = new WebSocketClient();
	ws.on('connectFailed', e => {
		console.log('WebSocket connection failed', e);
		module.emit('disconnected');
	});
	ws.on('connect', connection => {
		module.emit('connected', connection);
		connection.on('close', () => {
			module.emit('disconnected');
		});
		connection.on('error', e => {
			console.log('WebSocket error', e);
			module.emit('disconnected');
		});
		connection.on('message', async message => {
			const message_data = JSON.parse(message.utf8Data);
			if (message_data.request_id && receiving.includes(message_data.request_id))
				return;
			const request = await decodeMessage(connection, message_data, receiving);
			module.emit('message', request);
		});
	});
	ws.connect(websocket_url);
};

const ws = (module, {apc, options, local}, storage={receiving: [], status: 'disconnected'}) => ({
	hooks: [
		['init', () => {
			module.emit('connect');
		}],
		['connect', async () => {
			if (storage.ws && storage.ws.readyState > 1)
				return; // Possibly check if status is "connecting"
			const params = new URLSearchParams({authorization: options.credentials.token, ...local});
			storage.status = 'connecting';
			wsConnect(module, `${options.websocket_url}/?${params.toString()}`);
		}],
		['connected', (connection) => {
			storage.status = 'connected';
			storage.ws = connection;
			console.log('WebSocket connected');
			module.emit('send', {type: 'connected', data: local});
		}],
		['disconnected', () => {
			if (storage.status === 'connected') // Check why it disconnected
				module.emit('connect');
			storage.status = 'disconnected';
		}],
		['send', data => {
			return wsSend(storage.ws, data);
		}],
		['message', message => {
			apc.emit('message', message);
		}]
	]
});

module.exports = { ws };