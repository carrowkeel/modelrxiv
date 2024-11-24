
const hooks = [
	['[data-action="show-screenshot"]', 'click', e => {
		console.log(e);
		e.target.closest('.code-example').classList.toggle('show-screenshot');
	}]
];

const initializeTOC = (container) => {
	const headers = container.querySelectorAll('h2, h3, h4, h5, h6');
	if (headers.length === 0) return null;

	const toc = document.createElement('nav');
	toc.className = 'table-of-contents';
	const list = document.createElement('ul');

	let current_lists = { 2: list };
	let previous_level = 2;

	headers.forEach((header, index) => {
		if (!header.id) {
			header.id = `header-${index}`;
		}

		const level = parseInt(header.tagName.substring(1));
		const list_item = document.createElement('li');
		list_item.className = `toc-item toc-${header.tagName.toLowerCase()}`;

		const link = document.createElement('a');
		link.href = `#${header.id}`;
		link.textContent = header.textContent;
		list_item.appendChild(link);

		if (level > previous_level) {
			const new_sub_list = document.createElement('ul');
			current_lists[previous_level].lastElementChild.appendChild(new_sub_list);
			current_lists[level] = new_sub_list;
		} else if (level < previous_level) {
			for (let i = level + 1; i <= previous_level; i++) {
				delete current_lists[i];
			}
		}

		current_lists[level].appendChild(list_item);
		previous_level = level;
	});

	toc.appendChild(list);
	container.querySelector('.toc').appendChild(toc);

	const toc_links = toc.querySelectorAll('a');
	toc_links.forEach(link => {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			const target_id = link.getAttribute('href').substring(1);
			const target_element = document.getElementById(target_id);
			if (target_element) {
				window.scrollTo({
					top: target_element.offsetTop - 20,
					behavior: 'smooth'
				});
			}
		});
	});

	window.addEventListener('scroll', () => {
		let current_section = null;
		headers.forEach(header => {
			const header_top = header.getBoundingClientRect().top;
			if (header_top <= 40) {
				current_section = header;
			}
		});
		toc_links.forEach(link => {
			link.classList.remove('selected');
			if (current_section && link.getAttribute('href').substring(1) === current_section.id) {
				link.classList.add('selected');
			}
		});
	});
};

export const init = (container) => {
	initializeTOC(container);
	addHooks(container, hooks)
	container.querySelector('.toc li').classList.add('selected');
};