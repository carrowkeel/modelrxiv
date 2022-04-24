
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const rtcReceiveParts = (channel, request_id, parts = [], n = 0) => new Promise((resolve, reject) => {
	channel.addEventListener('message', e => { // Remove listener when resolved
		const message_data = JSON.parse(e.data);
		if (message_data.request_id !== request_id)
			return;
		parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length)
			resolve(parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join(''));
	});
});

const decodeMessage = async (channel, message_data, receiving) => {
	const compressed = message_data.parts > 1 && message_data.request_id ? await rtcReceiveParts(channel, message_data.request_id, [[message_data.part, message_data.data]], receiving.push(message_data.request_id)) : message_data.data;
	const decompressed = message_data.compression === 'json' ? JSON.parse(compressed) : compressed;
	return Object.assign(message_data, {data: decompressed});
};

const rtcSend = async (channel, request, rtc_message_limit = 100 * 1024) => { // The limit is higher so this could be increased
	const compressed = JSON.stringify(request.data);
	if (compressed.length > rtc_message_limit) {
		const parts = Math.ceil(compressed.length / rtc_message_limit);
		for (const part of range(0, parts)) {
			const data = JSON.stringify(Object.assign(request, {part, parts, compression: 'json', data: compressed.slice(part * rtc_message_limit, (part + 1) * rtc_message_limit)}));
			channel.send(data);
		}
	} else
		channel.send(JSON.stringify(request));
};

const handleChannelStatus = (rtc_module, channel, event, user) => { // Fix inconsistency of using "event" vs "e" in this file
	if (event.type === 'open') {
		rtc_module.emit('channelconnected', channel);
	} else if (event.type === 'close') {
		rtc_module.emit('channeldisconnected');
	}
};

const addDataChannel = (rtc_module, event, user, receiving, _channel) => {
	const channel = _channel || event.channel;
	channel.addEventListener('message', event => receiveMessage(rtc_module, channel, event, user, receiving));
	channel.addEventListener('open', event => handleChannelStatus(rtc_module, channel, event, user));
	channel.addEventListener('close', event => handleChannelStatus(rtc_module, channel, event, user));
	return channel;
};

const receiveMessage = async (rtc_module, channel, event, user, receiving) => {
	const message_data = JSON.parse(event.data);
	if (message_data.request_id && receiving.includes(message_data.request_id))
		return;
	const message = await decodeMessage(channel, message_data, receiving);
	rtc_module.emit('message', message);
};

const sendCandidate = (resource, event, user) => {
	if (event.candidate)
		resource.emit('send', {type: 'rtc', data: {type: 'ice_candidate', user, data: event.candidate}});
};

const processIceQueue = async (connection, queue) => {
	while (connection.signalingState === 'stable' && connection.iceConnectionState !== 'connected' && queue && queue.length > 0) {
		try {
			await connection.addIceCandidate(queue.shift());
		} catch (e) {
			console.log(e);
		}
	}
};

const handleSignalingState = async (connection, event, user) => {
};

const handleConnectionState = async (connection, event, user) => {
	if (connection.iceConnectionState === 'failed')
		connection.restartIce();
};

const createPeerConnection = (rtc_module, resource, user, ice_queue, receiving, active = true) => {
	const google_stun = {
		urls: [
			'stun:stun.l.google.com:19302',
			'stun:stun1.l.google.com:19302',
			'stun:stun2.l.google.com:19302',
			'stun:stun3.l.google.com:19302',
			'stun:stun4.l.google.com:19302'
		]
	};
	const connection = new (require('wrtc')).RTCPeerConnection({iceServers: [google_stun]});
	connection.addEventListener('icecandidate', event => sendCandidate(resource, event, user));
	connection.addEventListener('icecandidateerror', event => console.log(event));
	connection.addEventListener('signalingstatechange', event => handleSignalingState(connection, event, user));
	connection.addEventListener('iceconnectionstatechange', event => handleConnectionState(connection, event, user));
	connection.addEventListener('icegatheringstatechange', event => processIceQueue(connection, ice_queue));
	if (active)
		addDataChannel(rtc_module, undefined, user, receiving, connection.createDataChannel(user));
	else
		connection.addEventListener('datachannel', event => addDataChannel(rtc_module, event, user, receiving));
	return connection;
};

const processOffer = async (resource, user, connection, offer) => {
	return connection.setRemoteDescription(offer)
		.then(() => connection.createAnswer())
		.then(answer => connection.setLocalDescription(answer))
		.then(() => resource.emit('send', {type: 'rtc', data: {type: 'answer', user, data: connection.localDescription}}))
		.catch(e => console.log('Error processing offer: '+e));
};

const processAnswer = (connection, answer) => {
	if (connection.signalingState !== 'have-local-offer')
		return console.log(`Setting answer with ${connection ? connection.signalingState : 'no client'} state`, 'RTC process answer');
	connection.setRemoteDescription(answer)
		.catch(e => {
			console.log(e, 'RTC process answer');
			connection.restartIce();
		});
};

const sendOffer = (resource, user, connection) => {
	connection.createOffer()
		.then(offer => connection.setLocalDescription(offer))
		.then(() => resource.emit('send', {type: 'rtc', data: {type: 'offer', user, data: connection.localDescription}}))
		.catch(e => console.log(e));
};

const process = async (resource, user, connection, ice_queue, rtc_data) => {
	switch (rtc_data.type) {
		case 'offer':
			processOffer(resource, user, connection, rtc_data.data); // Implement queue
			break;
		case 'answer':
			processAnswer(connection, rtc_data.data);
			break;
		case 'ice_candidate':
			ice_queue.push(rtc_data.data);
			processIceQueue(connection, ice_queue);
			break;
	}
};

// Missing: configuration for local STUN server
const rtc = (module, {resource, connection_id: ws_connection_id, rtc_data}, storage={ice_queue: [], receiving: []}) => ({
	hooks: [
		['init', () => {

		}],
		['connect', (resolve) => {
			storage.peer_connection = createPeerConnection(module, resource, ws_connection_id, storage.ice_queue, storage.receiving); // Find a way to have this not in storage
			sendOffer(resource, ws_connection_id, storage.peer_connection);
			module.once('channelconnected', resolve);
		}],
		['receivedata', data => {
			if (!storage.peer_connection)
				storage.peer_connection = createPeerConnection(module, resource, ws_connection_id, storage.ice_queue, storage.receiving, false);
			process(resource, ws_connection_id, storage.peer_connection, storage.ice_queue, data);
		}],
		['channelconnected', (channel) => { // Update connection state
			storage.channel = channel;
			module.dataset.status = 'connected';
			// connected event for resource
		}],
		['channeldisconnected', e => {
			module.dataset.status = 'disconnected';
		}],
		['send', data => {
			// Move stream handling elsewhere
			const request = data; // Is this always request?
			if (request.data.constructor.name === 'Readable') {
				const stream = request.data;
				stream.on('readable', () => {
					while(true) {
						const value = stream.read();
						if (value === null)
							break;
						rtcSend(storage.channel, Object.assign({}, request, {data: value}));
					}
				});
				stream.on('close', () => rtcSend(storage.channel, Object.assign({}, request, {data: {stream_closed: true}})));
			} else
				rtcSend(storage.channel, request);
		}],
		['message', message => {
			resource.emit('message', message);
		}],
		['disconnect', () => {
			storage.peer_connection.close();
		}]
	]
});

module.exports = {rtc};
