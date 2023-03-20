
import {range, randint, linspace, round, sum, cumsum, mean, median} from './plot.js';

const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateID = l => Array.from(new Array(l)).map(v=>letters[randint(0, letters.length)]).join('');

// TODO: emulate CMYK to do mixing rather than using RGB
const mixer = (c1, w1, c2, w2) => {
	return !c2 ? c1 : c1.map((c,i) => c*w1 + c2[i]*w2);
};

const combineStatResults = results => {
	return results.length === 0 ? {} : Object.keys(results[0]).reduce((a, stat) => {
		return Object.assign(a, {[stat]: results.map(result => result[stat])});
	}, {});
};

const dataPoint = (output, param_ranges, result, _x, _y, step) => {
	// result.scores ? {color: mixer(...Object.values(result.scores).sort((a,b)=>b.prop-a.prop).slice(0, 2).reduce((a,v,i,arr)=>a.concat([v.color, v.prop/sum(arr.map(v=>v.prop))]), []))} : result;
	const color = output?.values ? output.values[result].color.split(',') : [0, 0, 0];
	const opacity = output.type === 'cont' ? result : 1;
	const [x, y, w, h] = [
		Math.min(Math.max(_x-step[0]/2, param_ranges.x.range[0]), param_ranges.x.range[1]),
		Math.min(Math.max(_y-step[1]/2, param_ranges.y.range[0]), param_ranges.y.range[1]),
		Math.min(step[0] + (_x - step[0]/2 < param_ranges.x.range[0] ? (_x - step[0]/2 - param_ranges.x.range[0]) : 0), param_ranges.x.range[1] - (_x - step[0]/2)),
		Math.min(step[1] + (_y - step[1]/2 < param_ranges.y.range[0] ? (_y - step[1]/2 - param_ranges.y.range[0]) : 0), param_ranges.y.range[1] - (_y - step[1]/2))
	];
	return [x, y, w, h, color, opacity, {'data-x': _x, 'data-y': _y, 'data-result': result}];
};

const init = async (container, entry, user_params, param_ranges, title='Meta', id=generateID(8)) => {
	const plot_name = `meta_${id}`;
	const ranges = Object.keys(param_ranges).length;
	const dist = (fixed_params, variable_params) => new Promise((resolve, reject) => {
		const request = { // Implement here benchmarks for time estimates and additional framework requirements (e.g., Python packages)
			id,
			name: entry.name,
			framework: entry.framework || 'js',
			sources: [ // The first item is the entry point and so the framework should match that of the request; in the browser only the first item will be imported
				{type: 'script', private: entry.private, model_id: entry.model_id, framework: entry.framework || 'js'}
			],
			fixed_params,
			variable_params,
			resolve,
			reject
		};
		document.querySelector('.apocentric').dispatchEvent(new CustomEvent('distribute', {detail: request}));
	}).catch(e => {
		console.log(e);
		return Promise.reject('Failed to run grid');
	}).then(combineStatResults);
	//const {module: plot_container} = await addModule(group, 'plot', {job: {id}});
	const step = Object.keys(param_ranges).reduce((a,k) => Object.assign(a, {[k]: param_ranges[k].type === 'select' ? 1 : (param_ranges[k].range[1] - param_ranges[k].range[0] === 0 ? 1 : (param_ranges[k].range[1] - param_ranges[k].range[0])) / 2**param_ranges[k].range[2]}), {});
	const axes = ['x', 'y', 'z', 's'].reduce((axes, axis) => {
		if (!param_ranges[axis])
			return axes;
		switch(param_ranges[axis].type) {
			case 'cont':
				return Object.assign(axes, {[axis]: linspace(param_ranges[axis].range[0], param_ranges[axis].range[1], 2**param_ranges[axis].range[2] + 1)});
			case 'disc':
				return Object.assign(axes, {[axis]: param_ranges[axis].range});
		}
	}, {});
	const stat = user_params.stat || entry.result_params[0].name; // TODO: Defaults to first stat
	switch(ranges) {
		case 1: {
			dist(user_params, axes.x.map(x => {
				return {[param_ranges.x.name]: x};
			})).then(async results => {
				console.log(results);
				for (const stat in results) {
					const output = Object.assign({}, entry.result_params.find(param => param.name === stat));
					const output_values = output.type === 'disc' ? Object.fromEntries(output.values.map(output => [output.name, output])) : {};
					const line = results[stat].map((value,i) => [[param_ranges.x.type === 'select' ? i : axes.x[i], output.type === 'disc' ? +(output_values[value].value) : value]]);
					const group = document.createElement('div');
					group.classList.add('group');
					container.appendChild(group);
					const {module: plot_module} = await addModule(group, 'plot');
					plot_module.dispatchEvent(new CustomEvent('init', {detail: {plot: {
						name: `${plot_name}_${stat}`,
						type: 'line_plot_x',
						xbounds: (param_ranges.x.type === 'select' ? [0, param_ranges.x.range.length - 1] : param_ranges.x.range.slice(0, 2)),
						ybounds: output.range ? output.range.split(',').map(v => +(v)) : [0, 1],
						draw: 'svg',
						param_ranges,
						labels: {title: output.label, x: param_ranges.x.label, y: output.units || 'Value'},
						outputs: entry.result_params
					}, params: user_params}}));
					plot_module.querySelector(`[data-name="${plot_name}_${stat}"]`).dispatchEvent(new CustomEvent('update', {detail: {data: line}}));
				}
			});
			break;
		}
		case 2: {
			const grid = axes.y.reduce((a,y) => {
				return a.concat(axes.x.map(x => {
					return {x, y, params: {[param_ranges.x.name]: x, [param_ranges.y.name]: y}};
				}));
			}, []);
			dist(user_params, grid.map(v => v.params)).then(async results => {
				for (const stat in results) {
					const output = Object.assign({}, entry.result_params.find(param => param.name === stat));
					if (output.values && output.values instanceof Array)
						output.values = Object.fromEntries(output.values.map(output => [output.name, output])); // TODO: Find a better solution, maybe do this when setting up entry. This previously caused an issue by mutated values for the submit form
					const squares = results[stat].map((result,i) => dataPoint(output, param_ranges, result, grid[i].x, grid[i].y, [step.x, step.y]));
					const group = document.createElement('div');
					group.classList.add('group');
					container.appendChild(group);
					const {module: plot_module} = await addModule(group, 'plot');
					plot_module.dispatchEvent(new CustomEvent('init', {detail: {plot: {
						name: `${plot_name}_${stat}`,
						type: 'hist_2d',
						xbounds: (param_ranges.x.type === 'select' ? [0, param_ranges.x.range.length - 1] : param_ranges.x.range.slice(0, 2)),
						ybounds: param_ranges.y.range.slice(0, 2),
						draw: 'canvas',
						params: user_params,
						param_ranges,
						labels: {title: `${title}, ${stat}`, x: param_ranges.x.label, y: param_ranges.y.label},
						outputs: entry.result_params
					}, params: user_params}}));
					plot_module.querySelector(`[data-name="${plot_name}_${stat}"]`).dispatchEvent(new CustomEvent('update', {detail: {data: squares}}));
					break;
				}
				//group.querySelectorAll('.plot').forEach(plot => plot.dispatchEvent(new Event('update')));
			});
			break;
		}
		case 3: { // At the moment this is for discrete parameters only
			const stat = entry.result_params[0].name; // Temporary to avoid breaking this
			const combine = (values) => {
				return values.reduce((a,v) => {
					return Object.assign(a, {[v]: a[v] ? a[v] + 1 / values.length : 1 / values.length});
				}, {});
			};
			const values = await dist(user_params, axes.z.reduce((a,z) => {
				return a.concat(axes.y.reduce((_a,y) => {
					return _a.concat(axes.x.map(x => {
						return {[param_ranges.x.name]: x, [param_ranges.y.name]: y, [param_ranges.z.name]: z};
					}));
				}, []));
			}, [])).then(results => {
				return range(0, axes.z.length).map(i => {
					return combine(results[stat].slice(i*axes.x.length*axes.y.length, (i+1)*axes.x.length*axes.y.length));
				});
			});
			const keys = Object.keys(values.reduce((a, v) => Object.keys(v).reduce((_a, k) => Object.assign(_a, {[k]: 1}), a), {}));
			const output_values = entry.result_params[0].values.reduce((a,v) => Object.assign(a, {[v.name]: v.value}), {});
			const sorted_keys = keys.sort((a,b) => output_values[a] - output_values[b]);
			const lines = keys.map(_i => values.map((value, i) => [[axes.z[i], value[_i] ? value[_i] : 0]]));
			const group = document.createElement('div');
			group.classList.add('group');
			container.appendChild(group);
			for (const i in lines) {
				const {module: plot_module} = await addModule(group, 'plot');
				plot_module.dispatchEvent(new CustomEvent('init', {detail: {plot: {
					name: `${plot_name}_${keys[i]}`,
					type: 'line_plot_x',
					xbounds: param_ranges.z.range.slice(0, 2),
					ybounds: [0, 1], // This limits this type of plot to proportions of outcomes
					draw: 'svg',
					param_ranges,
					labels: {title: `${title}, ${keys[i]}`, x: param_ranges.z.label, y: 'Proportion'},
					outputs: entry.result_params
				}, params: user_params}}));
				plot_module.querySelector(`[data-name="${plot_name}_${keys[i]}"]`).dispatchEvent(new CustomEvent('update', {detail: {data: lines[i]}}));
			}
			group.querySelectorAll('.plot').forEach(plot => plot.dispatchEvent(new Event('update')));
			break;
		}
		case 4: {
			const stat = entry.result_params[0].name; // Temporary to avoid breaking this
			const input_grids = axes.z.reduce((a,z) => {
				return a.concat(axes.y.reduce((_a,y) => {
					return _a.concat(axes.x.map(x => {
						return {[param_ranges.x.name]: x, [param_ranges.y.name]: y, [param_ranges.z.name]: z};
					}));
				}, []));
			}, []);
			const filtered_grids = await dist(Object.assign({}, user_params, {[param_ranges.s.name]: param_ranges.s.range[0], repeats: 1}), input_grids).then(results => {
				return range(0, axes.z.length).map(i => {
					return input_grids.slice(i*axes.x.length*axes.y.length, (i+1)*axes.x.length*axes.y.length)
						.filter((_,_i, input) => {
							return results[stat][i * input.length + _i] === user_params.outcome;
						});
				});
			});
			const filtered_indexes = [0].concat(cumsum(filtered_grids.slice(0, filtered_grids.length - 1).map(grid => grid.length)));
			const values = await dist(Object.assign({}, user_params, {[param_ranges.s.name]: param_ranges.s.range[1]}), filtered_grids.reduce((a,v) => a.concat(v), [])).then(results => {
				return filtered_indexes.map((_,i) => mean(results[stat].slice(filtered_indexes[i], filtered_indexes[i+1])));
			});
			const line = values.map((value,i) => [[axes.z[i], value]]);
			const group = document.createElement('div');
			group.classList.add('group');
			container.appendChild(group);
			const {module: plot_module} = await addModule(group, 'plot');
			plot_module.dispatchEvent(new CustomEvent('init', {detail: {plot: {
				name: `${plot_name}_${stat}`,
				type: 'line_plot_x',
				xbounds: param_ranges.z.range.slice(0, 2),
				ybounds: [0, 1],
				draw: 'svg',
				param_ranges,
				labels: {title, x: param_ranges.z.label, y: 'Proportion'},
				outputs: entry.result_params
			}, params: user_params}}));
			plot_module.querySelector(`[data-name="${plot_name}_${stat}"]`).dispatchEvent(new CustomEvent('update', {detail: {data: line}}));
			break;
		}
	}
};

export { init }