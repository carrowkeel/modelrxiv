
const resource = (module, {apc, resource, settings}, storage={}) => ({
	hooks: [
		['init', () => { // May not be necessary
			const threads = settings ? settings.used : (resource.cost > 0 ? 0 : resource.capacity);
			storage.used = threads;
		}],
		['establishrtc', () => {
			const connection_id = module.dataset.connection_id;
			storage.rtc = require('./add_module').addModule('rtc', {resource: module, connection_id});
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
				case 'request': {
					return new Promise((resolve, reject) => {
						apc.emit('job', message, resolve);
					}).then(result => {
						if (result instanceof ReadableStream)
							console.log(result.getReader());
						else
							module.emit('send', {type: 'result', request_id: message.request_id, data: result})
					});
				}
			}
		}]
	]
});

module.exports = {resource};
