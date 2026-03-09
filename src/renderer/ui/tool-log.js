// Live tool execution log UI

let container = null;
let hideTimer = null;

const TOOL_LABELS = {
	type_text: 'Typing text',
	press_key: 'Pressing key',
	click_at: 'Clicking',
	double_click: 'Double clicking',
	mouse_move: 'Moving mouse',
	drag: 'Dragging',
	scroll: 'Scrolling',
	open_app: 'Opening app',
	get_frontmost_app: 'Checking active app',
	window_manage: 'Managing window',
	read_file: 'Reading file',
	write_file: 'Writing file',
	list_directory: 'Listing directory',
	move_file: 'Moving file',
	get_finder_selection: 'Getting Finder selection',
	clipboard_read: 'Reading clipboard',
	clipboard_write: 'Writing to clipboard',
	web_search: 'Searching the web',
	ask_chatgpt: 'Asking ChatGPT',
	set_volume: 'Setting volume',
	notify: 'Sending notification',
	run_terminal_command: 'Running command',
	self_fix: 'Self-modifying code',
	propose_reply: 'Composing reply',
	manage_vocabulary: 'Updating vocabulary',
	get_mouse_position: 'Getting mouse position',
	use_skill: 'Loading skill',
};

function getContainer() {
	if (container) return container;
	container = document.getElementById('tool-log');
	if (!container) {
		container = document.createElement('div');
		container.id = 'tool-log';
		document.body.appendChild(container);
	}
	return container;
}

function formatArgs(name, args) {
	if (!args) return '';
	if (name === 'open_app' && args.name) return args.name;
	if (name === 'read_file' && args.path) return args.path.split('/').pop();
	if (name === 'write_file' && args.path) return args.path.split('/').pop();
	if (name === 'list_directory' && args.path) return args.path.split('/').pop() || args.path;
	if (name === 'web_search' && args.query) return `"${args.query}"`;
	if (name === 'ask_chatgpt' && args.prompt) return args.prompt.length > 40 ? args.prompt.slice(0, 40) + '…' : args.prompt;
	if (name === 'run_terminal_command' && args.command) return args.command.length > 120 ? args.command.slice(0, 120) + '…' : args.command;
	if (name === 'type_text' && args.text) return args.text.length > 30 ? args.text.slice(0, 30) + '…' : args.text;
	if (name === 'press_key' && args.key) return args.key;
	if (name === 'use_skill' && args.skill_name) return args.skill_name;
	if (name === 'notify' && args.message) return args.message.length > 40 ? args.message.slice(0, 40) + '…' : args.message;
	if (name === 'move_file') return [args.from, args.to].filter(Boolean).map(p => p.split('/').pop()).join(' → ');
	if (name === 'window_manage' && args.action) return args.action;
	if (name === 'set_volume' && args.level != null) return `${args.level}%`;
	return '';
}

export function getToolDisplay(name, args) {
	return {
		label: TOOL_LABELS[name] || name.replace(/_/g, ' '),
		detail: formatArgs(name, args),
	};
}

export function showToolStart(name, args, index, total) {
	clearTimeout(hideTimer);
	const el = getContainer();
	el.classList.add('visible');

	const { label, detail } = getToolDisplay(name, args);
	const counter = total > 1 ? `[${index + 1}/${total}] ` : '';

	const entry = document.createElement('div');
	entry.className = 'tool-entry running';
	entry.dataset.callId = `${name}-${index}`;
	entry.innerHTML = `<span class="tool-spinner"></span><span class="tool-counter">${counter}</span><span class="tool-label">${label}</span>${detail ? `<span class="tool-detail">${detail}</span>` : ''}`;
	el.appendChild(entry);

	// Keep only last 5 entries visible
	while (el.children.length > 5) {
		el.removeChild(el.firstChild);
	}
}

export function showToolDone(name, index, ok) {
	const el = getContainer();
	const entry = el.querySelector(`[data-call-id="${name}-${index}"]`);
	if (entry) {
		entry.classList.remove('running');
		entry.classList.add(ok ? 'success' : 'error');
		const spinner = entry.querySelector('.tool-spinner');
		if (spinner) spinner.textContent = ok ? '✓' : '✗';
	}
}

export function hideToolLog() {
	clearTimeout(hideTimer);
	hideTimer = setTimeout(() => {
		const el = getContainer();
		el.classList.remove('visible');
		setTimeout(() => { el.innerHTML = ''; }, 300);
	}, 2000);
}
