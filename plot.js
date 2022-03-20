
const color_cycle = [
	[31,119,180],
	[255,127,14],
	[44,160,44],
	[214,39,40],
	[148,103,189],
	[140,86,75],
	[227,119,194],
	[127,127,127],
	[188,189,34],
	[23,190,207]
];

const formatLabel = text => {
	const label = text.replace(/(^|[^a-zA-Z])([a-zA-Z])(_|\^)(\{([^\{]+)\}|[a-zA-Z0-9])/, (_, pre, name, type, sub, sub_curly) => `${pre}${name}<${type === '_' ? 'sub' : 'sup'}>${sub_curly || sub}</${type === '_' ? 'sub' : 'sup'}>`);
	return text.match(/^[a-zA-Z](_|$)/) ? `<i>${label}</i>` : label;
};

export const round = (n,p) => { var f = Math.pow(10, p); return Math.round(n * f) / f };
export const randint = (m, m1, g = Math.random) => Math.floor(g() * (m1 - m)) + m;
export const range = (start, end) => Array.from(Array(end-start)).map((v,i)=>i+start);
export const sum = (arr) => arr.reduce((a,v)=>a+v,0);
export const cumsum = arr => { let sum = 0; const out = []; for (const v of arr) { sum += v; out.push(sum) } return out; }
export const linspace = (a,b,c) => Array.from(new Array(c)).map((v,i) => round(a + i*((b-a)/(c-1)), 10));
export const quartile = (arr, q) => mean(Array.prototype.slice.apply(arr.sort((a,b)=>a-b),(arr.length-1)%(1/q)===0?[(arr.length-1)*q,(arr.length-1)*q+1]:[Math.floor((arr.length-1)*q),Math.ceil((arr.length-1)*q)+1]));
export const median = arr => quartile(arr, 0.5);
export const mean = arr => arr.length === 0 ? 0 : arr.reduce((a,v)=>a+v, 0)/arr.length;
export const vcomp = (a,b,m) => a.map((v,i) => Array.isArray(v)?vcomp(v,b[i],m):b[i]!=null?(m==2?v*b[i]:m==1?v-b[i]:v+b[i]):v);
export const stddev = arr => Math.pow(vcomp(Array(arr.length).fill(-mean(arr)),arr).map((v)=>Math.pow(v,2)).reduce((a,b)=>a+b) / (arr.length - 1), 0.5);
export const unique = arr => arr.length === 0 ? [] : Object.keys(arr.reduce((a,v)=>Object.assign(a, {[v]: 1}), {}));
export const concat = arr => arr.length === 0 ? [] : arr.reduce((a,v)=>a.concat(v), []);

const shorten = (n) => {
	if (n === 0 || (n < 1000 && n >= 0.01))
		return n;
	const e = Math.floor(Math.log10(n));
	return `${round(n/Math.pow(10, e), 1)}e${e}`;
};
const inbounds = (point, bounds) => point[0] >= bounds[0][0] && point[0] <= bounds[0][1] && point[1] >= bounds[1][0] && point[1] <= bounds[1][1];

const createSVG = (container, bounds =[[0, 1], [0, 1]], ratio=1) => {
	const w = Math.floor(container.getBoundingClientRect().width) - 1;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', w);
	svg.setAttribute('height', w*ratio);
	svg.dataset.width = w;
	svg.dataset.height = w*ratio;
	container.appendChild(svg);
	return svg_draw(svg, bounds);
};

const createCanvas = (container, bounds=[[0, 1], [0, 1]], ratio=1) => {
	const w = Math.floor(container.getBoundingClientRect().width) - 1;
	const canvas = document.createElement('canvas');
	canvas.setAttribute('width', w);
	canvas.setAttribute('height', w*ratio);
	canvas.dataset.width = w;
	canvas.dataset.height = w*ratio;
	container.appendChild(canvas);
	const ctx = canvas.getContext('2d');
	return canvas_draw(canvas, ctx, bounds);
};

const plot_types = [
	{
		slug: 'scatter_rt',
		label: 'Scatter plot (RT)',
		input: {x: ['cont'], y: ['cont']},
		draw: (draw, data, x, r=2, opacity=0.5) => {
			Object.keys(data[data.length - 1]).forEach(group => data[data.length - 1][group].forEach(point => draw.point(point, group, r, opacity)));
		}
	},
	{
		slug: 'line_plot_x',
		label: 'Line plot (x)',
		input: {x: ['cont'], y: ['cont']},
		draw: (draw, data) => {
			Object.keys(data[0]).forEach(i=>draw.line_x(data.map(step => step[i]), color_cycle[i]));
		},
	},
	{
		slug: 'line_plot',
		label: 'Line plot',
		input: {y: ['cont']},
		draw: (draw, data, x) => {
			if (data[0] instanceof Array)
				Object.keys(data[0]).forEach(i=>draw.line(data.map(step => step[i]), color_cycle[i], false, x));
			else
				draw.line(data, color_cycle[0], false, x); // Not ideal solution
		},
	},
	{
		slug: 'lines',
		label: 'Lines',
		input: {y: ['cont']},
		draw: (draw, data, x) => {
			const opacity = 0.1/(0.1 + Math.log(data[0].length));
			const mean_line = data.map(mean);
			if (data[0].length > 100) {
				const std = data.map(stddev);
				const points = mean_line.map((m,i) => [x + i, m - std[i]]).concat(mean_line.map((m,i) => [x + (mean_line.length - 1 - i), mean_line[mean_line.length - 1 - i] + std[mean_line.length - 1 - i]]));
				draw.polygon(points, color_cycle[0], 0.1);
			} else
				Object.keys(data[0]).forEach(i=>draw.line(data.map(step => step[i]), color_cycle[0], false, x, opacity));
			draw.line(mean_line, color_cycle[0], false, x, 1);
		},
	},
	{
		slug: 'hist_2d',
		label: 'Histogram 2D',
		input: {x: ['cont'], y: ['cont']},
		draw: (draw, _data) => {
			const data = Array.isArray(_data[0][0]) ? _data[_data.length - 1] : _data; // TODO: remove this hack
			draw.pre();
			data.forEach(point => draw.square(point.slice(0, 4), point[4], point[5], false));
			draw.post();
		},
	},
	{
		slug: 'line_1d',
		label: '1D line plot',
		input: {x: ['cont'], y: ['cont']},
		draw: (draw, lines) => {
			Object.keys(lines[lines.length - 1]).forEach(v=>draw.line_x(lines[v], color_cycle[v]));
		},
	},
	{
		slug: 'cells_2d',
		label: 'Cells 2D',
		input: {},
		draw: (draw, cells) => {
			draw.clear();
			cells[cells.length - 1].forEach(cell => draw.square(cell.slice(0, 4), cell[4], cell[5]));
		},
	},
	{
		slug: 'network',
		label: 'Network',
		input: {},
		draw: (draw, network) => {
			draw.clear();
			const min_size = 1;
			const scale = 10;
			const pos = [[0.5, 0.5], [0.5 + 0.1, 0.5], [0.5 + 0.1, 0.5 + 0.1], [0.5, 0.5 + 0.1], [0.5 - 0.1, 0.5 + 0.1]]; // Temp
			network[network.length - 1].forEach((node, i) => draw.point(pos[i], 0, min_size + scale * node.size, 1, node.color));
		},
	},
	{
		slug: 'proportion_plot',
		label: 'Proportions',
		input: {y: ['cont']},
		draw: (draw, data, x) => {
			const prev = new Array(data.length).fill(0);
			const lines = {};
			data.forEach((step,t) => Object.keys(step).forEach(k => lines[k] ? lines[k].push([t, step[k].prop, step[k].color]) : lines[k] = [[t, step[k].prop, step[k].color]]));
			Object.keys(lines).reduce((a,k)=>draw.filled_line(lines[k], a, x), prev);
		},
	},
];

const parse = (plot_template, params) => {
	return Object.assign({}, plot_template, {
		xbounds: plot_template.xbounds ? plot_template.xbounds.map(bound => typeof bound === 'string' ? params[bound] : bound) : undefined,
		ybounds: plot_template.ybounds ? plot_template.ybounds.map(bound => typeof bound === 'string' ? params[bound] : bound) : undefined
	});
};

const svg_draw = (svg, bounds=[[0, 1], [0, 1]], dims=[svg.dataset.width, svg.dataset.height].map(v=>+(v)), scale=bounds.map((v,i)=>dims[i]/(v[1]-v[0]))) => ({
	elem: svg,
	dims,
	bounds,
	pre: () => {},
	post: () => {},
	clear: function (query = '*') {
		svg.querySelectorAll(query).forEach(item => svg.removeChild(item));
	},
	filled_line: function (line, prev, offset=0) {
		const current = prev.slice();
		line.forEach(v=>current[v[0]]+=v[1]);
		this.polygon(prev.map((y,x)=>[offset+x, y])
			.concat(current.slice().reverse().map((y,x)=>[(offset+current.length-1-x), y])), line[0][2], 0.5, 'proportion');
		return current;
	},
	line_x: function (line, color) {
		this.polyline(line.map(([x,y])=>[(x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]]), color, 1, 'dynamic', {'data-value': line.map(v => v.map(v => round(v, 10)).join(';')).join(',')});
	},
	line: function (line, color, dynamic=true, offset=0, opacity=1) {
		this.polyline(line.map((y,x)=>[(offset+x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]]), color, opacity, dynamic ? 'dynamic' : '', {'data-value': line.map(v => round(v, 10)).join(',')});
	},
	square: function (s, color, opacity=1) {
		const [x, y] = [scale[0] * (s[0] - bounds[0][0]), scale[1] * (bounds[1][1]-s[1]-s[3])];
		const rect = [
			x,
			y,
			scale[0] * s[2],
			scale[1] * s[3]
		].map(v => round(v, 4));
		this.rect(...rect, color, opacity);
	},
	point: function ([x, y], i, r=2, opacity=1, color = color_cycle[i]) {
		this.circle((x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1], r, color, opacity, 'dynamic')
	},
	element: function (type, props) {
		const element = document.createElementNS('http://www.w3.org/2000/svg', type);
		for (const prop in props)
			element.setAttribute(prop, props[prop]);
		svg.appendChild(element);
		return element;
	},
	arrow: function (points, stroke=[255, 120, 0], opacity=0.5, classname='') {
		this.polyline(points, stroke, 1, classname);
	},
	rect: function (x, y, width, height, fill=[0, 0, 0], opacity=1, props={}, classname='') {
		this.element('rect', {x, y, width, height, fill: `rgb(${fill.join(',')})`, opacity, class: classname, ...props});
	},
	circle: function (x, y, r=3, fill=[0, 0, 0], opacity=1, classname='') {
		this.element('circle', {cx: x, cy: y, r, fill: `rgb(${fill.join(',')})`, opacity, class: classname});
	},
	polyline: function (points, stroke=[0, 0, 0], opacity=1, classname='', props={}) {
 		this.element('polyline', {points: points.map(v=>v.map(v=>round(v,3)).join(',')).join(' '), fill: 'none', stroke: `rgb(${stroke.join(',')})`, opacity, 'class': classname, ...props});
	},
	polygon: function (points, fill=[0, 0, 0], opacity=1, classname='', info='', transform='') { // Decide if this scales the values or some other function
		this.element('polygon', {points: points.map(([x,y])=>[(x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]].join(',')).join(' '), fill: `rgb(${fill.join(',')})`, opacity, 'class': classname, transform, 'data-info': info});
	},
	text: function (text, x, y, classname='', transform='') {
		const elem = this.element('text', {x, y, 'class': classname, transform});
		elem.textContent = text;
	},
	grid: function (gridres=40) {
		const xres = dims[0] / Math.floor(dims[0] / gridres);
		const yres = dims[1] / Math.floor(dims[1] / gridres);
		for (let x=xres;x<dims[0];x+=xres)
			this.rect(Math.round(x), 0, 1, dims[1], undefined, 0.1);
		for (let y=yres;y<dims[1];y+=yres)
			this.rect(0, Math.round(y), dims[0], 1, undefined, 0.1);
	}
});

const canvas_draw = (canvas, ctx, bounds=[[0, 1], [0, 1]], dims=[canvas.dataset.width, canvas.dataset.height].map(v=>+(v)), scale=bounds.map((v,i)=>dims[i]/(v[1]-v[0]))) => ({
	elem: canvas,
	pre: () => {
		ctx.translate(0.5, 0.5);
	},
	post: () => {
		ctx.translate(-0.5, -0.5);
	},
	clear: function () {
		ctx.clearRect(0, 0, ...dims);
		//this.grid();
	},
	filled_line: function (line, prev, offset) {
		const current = prev.slice();
		line.forEach(v=>current[v[0]]+=v[1]);
		this.polygon(prev.map((y,x)=>[(offset+x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]])
			.concat(current.slice().reverse().map((y,x)=>[(offset+current.length-1-x)*scale[0], (bounds[1][1]-y)*scale[1]])), line[0][2], 0.5);
		return current;
	},
	line_x: function (line, color) {
		this.polyline(line.map(([x,y])=>[(x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]]), color, 1);
	},
	line: function (line, color, dynamic=false, offset=0, opacity=1) {
		if (line[0].length === 2)
			this.polyline(line.map(([x,y])=>[(x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]]), color, opacity);
		else
			this.polyline(line.map((y,x)=>[(offset+x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1]]), color, opacity);
	},
	square: function (s, color, opacity=1, stroke=false) {
		const [x, y] = [scale[0] * (s[0] - bounds[0][0]), scale[1] * (bounds[1][1]-s[1]-s[3])];
		const rect = [
			x,
			y,
			scale[0] * s[2],
			scale[1] * s[3]
		].map(v => round(v, 4));
		this.rect(...rect, color, opacity, stroke);
	},
	point: function ([x, y], i, r=2, opacity) {
		this.circle((x-bounds[0][0])*scale[0], (bounds[1][1]-y)*scale[1], r, color_cycle[i], opacity)
	},
	rect: function (x, y, width, height, fill=[0, 0, 0], opacity=1, stroke=false) {
		ctx.fillStyle = `rgba(${fill.join(',')},${opacity})`;
		ctx.fillRect(x, y, width, height);
		if (stroke) {
			ctx.strokeStyle = `rgba(${fill.join(',')},${opacity/1})`;
			ctx.strokeRect(x, y, width, height);
		}
	},
	circle: function (x, y, r=3, fill=[0, 0, 0], opacity=1, classname='') {
		//this.element('circle', {cx: x, cy: y, r, fill, opacity, class: classname});
	},
	polyline: function (points, stroke=[0, 0, 0], opacity=1, classname='', info='') {
		ctx.beginPath();
		ctx.moveTo(points[0][0], points[0][1]);
		points.slice(1).forEach(v => ctx.lineTo(v[0], v[1]));
		ctx.strokeStyle = `rgba(${stroke.join(',')},${opacity})`;
		ctx.stroke();
		ctx.closePath();
	},
	polygon: function (points, fill=[0, 0, 0], opacity=1, classname='', info='', transform='') {
		ctx.beginPath();
		ctx.moveTo(points[0][0], points[0][1]);
		points.slice(1).forEach(v => ctx.lineTo(v[0], v[1]));
		ctx.fillStyle = `rgba(${fill.join(',')},${opacity})`;
		ctx.fill();
		ctx.closePath();
	},
	text: function (text, x, y, rotate=0) {
		ctx.fillStyle = 'rgb(0,0,0)';
		ctx.style = 'font-size:16px';
		if (rotate !== 0) {
			ctx.save();
			ctx.rotate((Math.PI / 180) * rotate);
			ctx.fillText(text, x, y);
			ctx.restore();
		} else {
			ctx.fillText(text, x, y);
		}
	},
	grid: function (gridres=40) {
		const xres = dims[0] / Math.floor(dims[0] / gridres);
		const yres = dims[1] / Math.floor(dims[1] / gridres);
		for (let x=xres;x<dims[0];x+=xres)
			this.rect(Math.round(x), 0, 1, dims[1], undefined, 0.1);
		for (let y=yres;y<dims[1];y+=yres)
			this.rect(0, Math.round(y), dims[0], 1, undefined, 0.1);
	}
});

export const plot = (env, {job}, elem, storage={}) => ({
	render: async () => {
		elem.classList.add('plot');
		elem.innerHTML = `<div class="header"><div class="settings-menu menu"><a data-action="close">Hide</a><a data-action="split">Split</a><a data-action="save">Save SVG</a><a data-action="export">Export</a></div><a data-icon="f" data-action="settings-menu" class="settings fright"></a><div class="figure-selector"></div></div><div class="legend"></div><div class="draw_area">${job ? `<div class="overlay" data-job="${job.id}"></div>` : ''}</div>`;
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="plot"]', 'init', e => {
			const {plot: plot_template, params} = e.detail;
			elem.setAttribute('draggable', 'true');
			const plot = parse(plot_template, params);
			const plot_element = elem.querySelector(`[data-name="${plot.name}"]`) ? elem.querySelector(`[data-name="${plot.name}"]`) : document.createElement('div'); // Temporary fix, this redraws the plot using the same DOM element
			plot_element.dataset.plot = plot.type; // Fix
			for (const prop in plot)
				plot_element.dataset[prop] = typeof plot[prop] !== 'string' ? JSON.stringify(plot[prop]) : plot[prop];
			plot_element.innerHTML = `<div class="axis-label label-x">${formatLabel(plot.labels.x)}</div><div class="axis-label label-y">${formatLabel(plot.labels.y)}</div>${plot.xbounds[0] === plot.ybounds[0] ? `<div class="axis-tick min">${shorten(plot.xbounds[0])}</div>` : `<div class="axis-tick xmin">${shorten(plot.xbounds[0])}</div><div class="axis-tick ymin editable" title="Edit y-axis">${shorten(plot.ybounds[0])}</div>`}<div class="axis-tick xmax">${shorten(plot.xbounds[1])}</div><div class="axis-tick ymax editable" title="Edit y-axis">${shorten(plot.ybounds[1])}</div></div>`;
			elem.querySelector('.draw_area').appendChild(plot_element);
			const bounds = [plot.xbounds, plot.ybounds];
			const draw = plot.type === 'proportion_plot' || plot.draw === 'canvas' ? createCanvas(plot_element, bounds) : createSVG(plot_element, bounds);
			elem.dispatchEvent(new Event('update'));
		}],
		['[data-module="plot"]', 'update', e => {
			const selector = elem.querySelector('.figure-selector');
			const plots = Array.from(elem.closest('.group').querySelectorAll('[data-plot]')).map(plot => Object.assign({}, plot.dataset, {labels: JSON.parse(plot.dataset.labels)}));
			if (plots.length === 0)
				return e.target.remove();
			switch(true) {
				case ['hist_2d'].includes(plots[0].plot):
					plots.forEach(plot => {
						if (!selector.querySelector(`[data-figure="${plot.name}"]`)) {
							const link = document.createElement('a');
							link.dataset.figure = plot.name;
							link.innerHTML = formatLabel(plot.labels.title);
							selector.appendChild(link);
						}
					});
					break;
				case ['line_plot', 'line_plot_x', 'lines'].includes(plots[0].plot):
					selector.innerHTML = `<a>${plots.length === 1 ? formatLabel(plots[0].labels.title) : formatLabel(plots[0].labels.y)}</a>`;
					elem.querySelector('.legend').innerHTML = plots.map(plot => {
						return `<a data-line="${plot.name}">${formatLabel(plot.labels.title)}</a>`;
					}).join('');
			}
		}],
		['[data-module="plot"]', 'split', e => {
			const container = e.target.closest('.group');
			for (const plot of container.querySelectorAll('.plot')) {
				const group = document.createElement('div');
				group.classList.add('group');
				container.parentElement.insertBefore(group, container);
				group.appendChild(plot);
				group.querySelectorAll('.plot').forEach(plot => plot.dispatchEvent(new Event('update')));
			}
			container.remove();
		}],
		['[data-plot]', 'modify', e => {
			const {plot: plot_template, params} = e.detail;
			const plot = parse(plot_template, params);
			for (const prop in plot)
				if (plot[prop])
					e.target.dataset[prop] = typeof plot[prop] !== 'string' ? JSON.stringify(plot[prop]) : plot[prop];
			if (plot.xbounds) // Need to add min
				e.target.querySelector('.xmax').innerText = shorten(plot.xbounds[1]);
			if (plot.ybounds)
				e.target.querySelector('.ymax').innerText = shorten(plot.ybounds[1]);
			const svg_elem = e.target.querySelector('svg');
			const canvas_elem = e.target.querySelector('canvas');
			if (!svg_elem && !canvas_elem)
				return;
			const draw_elem = svg_elem ? svg_draw(svg_elem) : canvas_draw(canvas_elem, canvas_elem.getContext('2d'));
			draw_elem.clear();
		}],
		['[data-plot]', 'update', e => {
			const {data, offset, flush} = e.detail;
			const svg_elem = e.target.querySelector('svg');
			const canvas_elem = e.target.querySelector('canvas');
			if (!svg_elem && !canvas_elem)
				return;
			const bounds = [e.target.dataset.xbounds, e.target.dataset.ybounds].map(JSON.parse);
			const draw_elem = svg_elem ? svg_draw(svg_elem, bounds) : canvas_draw(canvas_elem, canvas_elem.getContext('2d'), bounds);
			if (svg_elem)
				draw_elem.clear('.dynamic');
			if (offset === 0 || flush)
				draw_elem.clear();
			plot_types.find(plot => plot.slug === e.target.dataset.plot).draw(draw_elem, data, offset);
		}],
		['[data-figure]', 'click', e => {
			const figure = e.target.dataset.figure;
			elem.querySelector('.group').insertBefore(elem.querySelector(`[data-plot][data-name="${figure}"]`), elem.querySelector('[data-plot]:first-child'));
			elem.querySelector('.figure-selector').insertBefore(e.target, elem.querySelector('.figure-selector>a:first-child'));
		}],
		['[data-action="split"]', 'click', e => {
			e.target.closest('.plot').dispatchEvent(new Event('split'));
		}],
		['[data-action="close"]', 'click', e => {
			e.target.closest('.plot').remove();
		}],
		['[data-plot="hist_2d"]', 'mouseenter', e => {
			const plot = e.target;
			if (!plot.querySelector('.legend-hover')) {
			const outputs = plot.dataset.outputs;
				if (!outputs)
					return;
				const legend = JSON.parse(outputs)[0].values.map(value => `<a data-color="${value.color}">${value.name}</a>`).join('');
				const elem = document.createElement('div');
				elem.classList.add('menu', 'data-menu', 'legend-hover');
				elem.innerHTML = legend;
				elem.querySelectorAll('[data-color]').forEach(elem => elem.style.borderLeft = `20px solid rgb(${elem.dataset.color})`);
				plot.appendChild(elem);
			}
			const menu = plot.querySelector('.legend-hover');
			menu.classList.add('show');
		}],
		['[data-plot="hist_2d"]', 'mouseleave', e => {
			//if (e.toElement.closest('[data-plot]') === e.target)
			//	return;
			e.target.querySelectorAll('.legend-hover').forEach(elem => elem.classList.remove('show'));
		}],
		['[data-plot="hist_2d"] canvas, [data-plot="hist_2d"] svg', 'click', e => {
			const plot = e.target.closest('[data-plot]');
			if (!plot.querySelector('.canvas-hover')) {
				const elem = document.createElement('div');
				elem.innerHTML = `<a data-action="run_model">Run model</a>`;
				elem.classList.add('menu', 'data-menu', 'canvas-hover');
				plot.appendChild(elem);
			}
			const menu = plot.querySelector('.canvas-hover');
			menu.dataset.x = e.offsetX;
			menu.dataset.y = e.offsetY;
			menu.style.left = (e.offsetX + 5) + 'px';
			menu.style.top = (e.offsetY + 25) + 'px';
			menu.classList.add('show');
		}],
		['.plot', 'dragstart', e => {
			e.target.classList.add('dragged');
		}],
		['.plot', 'dragend', e => {
			e.target.classList.remove('dragged');
		}],
		['.group *, .group', 'dragover', e => {
			e.preventDefault();
			const target_group = e.target.closest('.group');
			const dragged = document.querySelector('.plot.dragged');
			if (!dragged || e.target === dragged || dragged.closest('.group') === target_group)
				return;
			target_group.classList.add('dragover');
		}],
		['.group *, .group', 'drop', e => {
			e.preventDefault();
			const target_group = e.target.closest('.group');
			const dragged = document.querySelector('.plot.dragged');
			const source_group = dragged.closest('.group');
			target_group.appendChild(dragged);
			target_group.classList.remove('dragover');
			dragged.classList.remove('dragged');
			if (source_group.querySelectorAll('.plot').length === 0)
				source_group.remove();
			else
				source_group.querySelectorAll('.plot').forEach(plot => plot.dispatchEvent(new Event('update')));
			target_group.querySelectorAll('.plot').forEach(plot => plot.dispatchEvent(new Event('update')));
		}],
		['.group *, .group', 'dragleave', e => {
			const target_group = e.target.closest('.group');
			target_group.classList.remove('dragover');
		}],
		['[data-action]', 'click', e => {
			const action = e.target.dataset.action;
			const plot = e.target.closest('.plot').querySelector('[data-plot]');
			switch(action) {
				case plot.querySelector('svg') ? 'save' : false: {
					const data = plot.querySelector('svg').outerHTML;
					const elem = document.createElement('a');
					elem.href = URL.createObjectURL(new Blob([data], {type: 'image/svg'}));
					elem.download = `${plot.dataset.name}.svg`;
					document.body.appendChild(elem);
					elem.click();
					elem.remove();
					break;
				}
				case 'export': {
					const data = (() => {switch(plot.dataset.plot) {
						case 'hist_2d':
							return 'x\ty\tsignal\n'+Array.from(plot.querySelectorAll(`[data-score]`)).map(v => [+(v.dataset.x), +(v.dataset.y), +(v.dataset.signal)].join(' ')).join('\n');
						case 'line_plot': {
							const xbounds = JSON.parse(plot.dataset.xbounds);
							const data = Array.from(plot.querySelectorAll(`[data-value]`)).map(v => v.dataset.value.split(',').map(_v => +(_v)));
							return Array.from(new Array(data[0].length)).map((v,i) => xbounds[0] + i*((xbounds[1]-xbounds[0])/(data[0].length - 1))).map((x,i) => [x, ...data.map(a => a[i])].join(' ')).join('\n');
						}
						case 'line_plot_x': {
							const data = Array.from(plot.querySelectorAll(`[data-value]`)).map(v => v.dataset.value.split(',').map(_v => _v.split(';').map(_v => +(_v))));
							return Array.from(new Array(data[0].length)).map((x,i) => data.map(a => a[i].join(' ')).join(' ')).join('\n');
						}
					}})();
					const elem = document.createElement('a');
					elem.href = URL.createObjectURL(new Blob([data], {type: 'text/plain'}));
					elem.download = `${plot.dataset.name}.txt`;
					document.body.appendChild(elem);
					elem.click();
					elem.remove();
					break;
				}
			}
		}],
		['.ymin, .ymax', 'click', e => {
			e.target.innerHTML = `<input type="text" value="${e.target.innerText}">`;
			e.target.querySelector('input').select();
		}],
		['.ymin input, .ymax input', 'keyup', e => {
			const plot = e.target.closest('[data-plot]');
			if (e.keyCode !== 13)
				return;
			e.target.parentElement.innerHTML = shorten(+(e.target.value));
			const ybounds = [plot.querySelector('.ymin, .min').innerText, plot.querySelector('.ymax').innerText].map(v => +(v));
			plot.closest('.group').querySelectorAll('[data-plot]').forEach(plot => plot.dispatchEvent(new CustomEvent('modify', {detail: {plot: {ybounds}}})));
		}],
	]
});