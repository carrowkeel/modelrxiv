
const resource = (module, {apc, resource, settings}, storage={}) => ({
	hooks: [
		['init', () => { // May not be necessary
			const threads = settings ? settings.used : (resource.cost > 0 ? 0 : resource.capacity);
			storage.used = threads;
		}],
		['establishrtc', () => {
			const connection_id = e.target.dataset.connection_id;
			storage.rtc = require('./add_module').addModule('rtc', {connection_id});
			storage.rtc.emit('connect', module);
		}],
		['processrtc', rtc_data => {
			const connection_id = e.target.dataset.connection_id;
			if (!storage.rtc && e.detail.type === 'offer')
				storage.rtc = require('./add_module').addModule('rtc', {connection_id});
			storage.rtc.emit('receivedata', rtc_data);
		}],
		['send', data => {
			if (e.target.dataset.connection_id === 'local')
				return module.emit('message', data);
			if (storage.rtc && storage.rtc.status === 'connected')
				return storage.rtc.emit('send', data);
			const ws = apc.storage.ws;
			// Decide where to handle problems with data unsuitable to be sent via WebSocket (i.e. too big)
			ws.emit('send', Object.assign(e.detail, {user: e.target.dataset.connection_id}));
		}],
		['message', message => {
			switch(message.type) {
				case 'rtc':
					return module.emit('processrtc', message.data);
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
