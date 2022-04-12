
const addHooks = (emitter, events) => {
	events.forEach(([type, fn]) => {
		emitter.on(type, fn);
	});
};

const addModule = (name, options={}) => {
	const EventEmitter = require('events');
	const module = new EventEmitter();
	const module_data = require(`./${name}`)[name](module, options);
	module.dataset = {};
	Object.keys(options).forEach(k => typeof options[k] !== 'object' ? module.dataset[k] = options[k] : 0);
	if (module_data.hooks)
		addHooks(module, module_data.hooks);
	module.emit('init');
	return module;
};

module.exports = { addModule };