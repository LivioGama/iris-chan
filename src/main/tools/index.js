const skills = require('../skills');
const log = require('../logger');
const workspace = require('../workspace');

const TOOL_MODULES = ['./input', './apps', './files', './clipboard', './search', './system', './meta', './design', './3d-gen', './auth'];

function loadHandlers() {
	const input = require('./input');
	const apps = require('./apps');
	const files = require('./files');
	const clipboard = require('./clipboard');
	const search = require('./search');
	const system = require('./system');
	const meta = require('./meta');
	const design = require('./design');
	const gen3d = require('./3d-gen');
	const auth = require('./auth');
	return {
		type_text: input.type_text, press_key: input.press_key,
		click_at: input.click_at, double_click: input.double_click,
		mouse_move: input.mouse_move, drag: input.drag, scroll: input.scroll, activate_app: input.activate_app,
		open_app: apps.open_app, get_frontmost_app: apps.get_frontmost_app,
		window_manage: apps.window_manage,
		read_file: files.read_file, write_file: files.write_file,
		list_directory: files.list_directory, move_file: files.move_file,
		get_finder_selection: files.get_finder_selection,
		download_browser_image: files.download_browser_image,
		clipboard_read: clipboard.clipboard_read, clipboard_write: clipboard.clipboard_write,
		web_search: search.web_search, ask_chatgpt: search.ask_chatgpt,
		set_volume: system.set_volume, notify: system.notify,
		run_terminal_command: system.run_terminal_command,
		self_fix: meta.self_fix, propose_reply: meta.propose_reply,
		manage_vocabulary: meta.manage_vocabulary, get_mouse_position: meta.get_mouse_position,
		import_logs: meta.import_logs,
		wait_for: design.wait_for, click_and_wait: design.click_and_wait,
		drag_with_snap: design.drag_with_snap, multi_click: design.multi_click,
		measure_vector: design.measure_vector, pause_and_wait: design.pause_and_wait,
		slow_move: design.slow_move,
		generate_3d_model: gen3d.generate_3d_model, check_3d_setup: gen3d.check_3d_setup,
		auto_2fa: auth.auto_2fa,
	};
}

let builtinHandlers = loadHandlers();

function reload() {
	for (const mod of TOOL_MODULES) {
		const resolved = require.resolve(mod);
		delete require.cache[resolved];
	}
	builtinHandlers = loadHandlers();
	log.info('Tools', 'Reloaded all tool modules');
}

async function execute(name, args) {
	// Workspace tools
	if (name === 'set_workspace') {
		const dir = args?.directory || args?.path || '';
		if (!dir) return { ok: false, result: 'No directory provided' };
		return workspace.set(dir);
	}
	if (name === 'get_workspace') {
		return { ok: true, result: workspace.get() };
	}

	// use_skill: on-demand skill content retrieval
	if (name === 'use_skill') {
		return skills.getSkillContent(args?.skill_name || '');
	}

	// Check built-in handlers first
	const builtin = builtinHandlers[name];
	if (builtin) return builtin(args || {});

	// Check skill handlers
	const skillHandler = skills.getHandler(name);
	if (skillHandler) {
		try {
			return await skillHandler(args || {});
		} catch (err) {
			return { ok: false, result: `Skill error: ${err.message}` };
		}
	}

	return { ok: false, result: `Unknown tool: ${name}` };
}

module.exports = { execute, reload };
