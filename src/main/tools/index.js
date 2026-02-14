// Tool registry: name → handler dispatch
const input = require('./input');
const apps = require('./apps');
const files = require('./files');
const clipboard = require('./clipboard');
const search = require('./search');
const system = require('./system');
const meta = require('./meta');

const handlers = {
	// Input tools
	type_text: input.type_text,
	press_key: input.press_key,
	click_at: input.click_at,
	double_click: input.double_click,
	mouse_move: input.mouse_move,
	drag: input.drag,
	scroll: input.scroll,
	// App tools
	open_app: apps.open_app,
	get_frontmost_app: apps.get_frontmost_app,
	window_manage: apps.window_manage,
	// File tools
	read_file: files.read_file,
	write_file: files.write_file,
	list_directory: files.list_directory,
	// Clipboard tools
	clipboard_read: clipboard.clipboard_read,
	clipboard_write: clipboard.clipboard_write,
	// Search tools
	web_search: search.web_search,
	ask_chatgpt: search.ask_chatgpt,
	// System tools
	set_volume: system.set_volume,
	notify: system.notify,
	run_terminal_command: system.run_terminal_command,
	// Meta tools
	self_fix: meta.self_fix,
	propose_reply: meta.propose_reply,
	manage_vocabulary: meta.manage_vocabulary,
	get_mouse_position: meta.get_mouse_position,
};

async function execute(name, args) {
	const handler = handlers[name];
	if (!handler) return { ok: false, result: `Unknown tool: ${name}` };
	return handler(args || {});
}

module.exports = { execute };
