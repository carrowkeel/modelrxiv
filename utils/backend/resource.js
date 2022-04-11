
const resource = (module, {resource, settings, queue}, storage={}) => ({
	hooks: [
		['init', () => { // May not be necessary
			const threads = settings ? settings.used : (resource.cost > 0 ? 0 : resource.capacity);
			storage.used = threads;
		}],
		['establishrtc', () => {
			const connection_id = e.target.dataset.connection_id;
			storage.rtc = addModule('rtc', {connection_id});
			storage.rtc.emit('connect', module);
		}],
		['processrtc', rtc_data => {
			const connection_id = e.target.dataset.connection_id;
			if (!e.target.querySelector('[data-module="rtc"]') && e.detail.type === 'offer')
				storage.rtc = addModule('rtc', {connection_id});
			storage.rtc.emit('receivedata', rtc_data);
		}],
		['send', e => {
			if (e.target.dataset.connection_id === 'local')
				return elem.dispatchEvent(new CustomEvent('message', {detail: {message: e.detail}}));
			if (e.target.querySelector('[data-module="rtc"]') && e.target.querySelector('[data-module="rtc"]').dataset.status === 'connected')
				return e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('send', {detail: e.detail}));
			// Locate ws element...
			const ws = e.target.closest('.apocentric').querySelector('[data-module="ws"]');
			// Decide where to handle problems with data unsuitable to be sent via WebSocket (i.e. too big)
			ws.dispatchEvent(new CustomEvent('send', {detail: Object.assign(e.detail, {user: e.target.dataset.connection_id})}));
		}],
		['message', e => {
			const message = e.detail.message;
			switch(message.type) {
				case 'rtc':
					return elem.dispatchEvent(new CustomEvent('processrtc', {detail: message.data}));
				case 'request': { // Should this be here or in apc
					return new Promise((resolve, reject) => {
						elem.closest('[data-module="apc"]').dispatchEvent(new CustomEvent('job', {detail: {request: message, resolve}}));
					}).then(result => elem.dispatchEvent(new CustomEvent('send', {detail: {type: 'result', request_id: message.request_id, data: result}})));
				}
			}
		}],
		['.apocentric', 'resourcestatus', e => {
			const active_threads = e.detail.workers.filter(v => v !== undefined).length;
			const used = active_threads / e.detail.threads;
			e.target.closest('.apocentric').querySelector('.resources-icon').dataset.notify = active_threads;
		}]
	]
});

module.exports = {resource};
