
const resource = (module, {apc, resource, settings, active}, storage={}) => ({
	hooks: [
		['init', () => { // May not be necessary
			const threads = settings ? settings.used : resource.capacity;
			module.dataset.connectionState = 1;
			storage.used = threads;
			if (module.dataset.connection_id !== 'local' && active)
				module.emit('establishrtc');
		}],
		['wsconnected', (connection_id) => {
			if (connection_id)
				module.dataset.connection_id = connection_id;
			module.dataset.connectionState |= 1;
			module.emit('connectionstatechange');
		}],
		['wsdisconnected', () => {
			module.dataset.connectionState &= ~1;
			module.emit('connectionstatechange');
		}],
		['establishrtc', () => {
			const connection_id = module.dataset.connection_id;
			storage.rtc = require('./add_module').addModule('rtc', {resource: module, connection_id});
			storage.rtc.on('connected', e => {
				module.dataset.connectionState |= 2;
				module.emit('connectionstatechange');
			});
			storage.rtc.on('disconnected', e => {
				module.dataset.connectionState &= ~2;
				module.emit('connectionstatechange');
			});
			storage.rtc.emit('connect');
		}],
		['processrtc', rtc_data => {
			const connection_id = module.dataset.connection_id;
			if (!storage.rtc && rtc_data.type === 'offer') {
				storage.rtc = require('./add_module').addModule('rtc', {resource: module, connection_id});
				storage.rtc.emit('receivedata', rtc_data);
			} else if (storage.rtc)
				storage.rtc.emit('receivedata', rtc_data);
		}],
		['send', data => {
			if (module.dataset.connection_id === 'local')
				return module.emit('message', data);
			if (storage.rtc && storage.rtc.dataset.status === 'connected')
				return storage.rtc.emit('send', data);
			apc.emit('send', Object.assign(data, {user: module.dataset.connection_id}));
		}],
		['message', message => {
			switch(message.type) {
				case 'rtc':
					return module.emit('processrtc', message.data);
				case 'terminate':
					return apc.emit('message', message); // Example implementation of termination signal
				case 'request': {
					return new Promise((resolve, reject) => {
						apc.emit('job', message, resolve);
					}).then(result => module.emit('send', {type: 'result', request_id: message.request_id, data: result}));
				}
			}
		}]
	]
});

module.exports = {resource};
