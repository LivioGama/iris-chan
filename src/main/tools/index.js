const skills = require('../skills');
const log = require('../logger');
const workspace = require('../workspace');

const TOOL_MODULES = ['./input', './apps', './files', './clipboard', './search', './system', './vocab', './self-fix', './input-meta', './design', './3d-gen', './auth', './fix-project', './task-queue'];

function loadHandlers() {
	const handlers = {};
	for (const mod of TOOL_MODULES) {
		try {
			const exports = require(mod);
			for (const [name, fn] of Object.entries(exports)) {
				if (typeof fn === 'function') {
					handlers[name] = fn;
				}
			}
		} catch (err) {
			log.error('Tools', `Failed to load module ${mod}: ${err.message}`);
		}
	}
	log.info('Tools', `Loaded ${Object.keys(handlers).length} tool handlers`);
	return handlers;
}

let builtinHandlers = loadHandlers();

function reload() {
	for (const mod of TOOL_MODULES) {
		try {
			const resolved = require.resolve(mod);
			delete require.cache[resolved];
		} catch (err) {
			log.warn('Tools', `Could not resolve ${mod} for cache clear: ${err.message}`);
		}
	}
	try {
		builtinHandlers = loadHandlers();
		log.info('Tools', 'Hot-reloaded all tool modules');
	} catch (err) {
		log.error('Tools', `Hot-reload failed: ${err.message}`);
	}
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

	const builtin = builtinHandlers[name];
	if (builtin) {
		try {
			return await builtin(args || {});
		} catch (err) {
			log.error('Tools', `Handler error in ${name}: ${err.message}`);
			return { ok: false, result: `Tool error: ${err.message}` };
		}
	}

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
