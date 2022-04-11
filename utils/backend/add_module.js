
const addHooks = (emitter, events) => {
	events.forEach(([type, fn]) => {
		emitter.on(type, fn);
	});
};

const addModule = (name, options={}) => {
	const emitter = new require('events')();
	const module = require(`./${name}`)[name](options);
	module.dataset = {};
	module.dataset.module = name;
	Object.keys(options).forEach(k => typeof options[k] !== 'object' ? module.dataset[k] = options[k] : 0);
	addHooks(module, module.hooks);
	module.emit('init', module);
	return module;
};

module.exports = { addModule };