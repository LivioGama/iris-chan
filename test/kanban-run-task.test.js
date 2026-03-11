const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

require('ts-node').register({ transpileOnly: true });

console.log('Running kanban run-task tests...');

const handlers = new Map();
const originalLoad = Module._load;
let observedArgs = null;

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'electron') {
		return {
			ipcMain: {
				handle(channel, handler) {
					handlers.set(channel, handler);
				},
			},
		};
	}
	if (request === '../windows/kanban-window') {
		return { get: () => null };
	}
	if (request === '../logger') {
		return { info() {}, warn() {}, error() {} };
	}
	if (request === '../convex-store') {
		return { saveTurn: async () => {} };
	}
	if (request === '../tools/fix-project') {
		return {
			fix_project: async (args) => {
				observedArgs = args;
				return { ok: true, result: 'queued' };
			},
		};
	}
	return originalLoad.apply(this, arguments);
};

const kanbanController = require('../src/main/controllers/kanbanController');
kanbanController.register();

const runTask = handlers.get('run-task');
assert.ok(runTask, 'run-task IPC handler should be registered');

(async () => {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-kanban-run-'));
	const originalCwd = process.cwd();

	try {
		fs.writeFileSync(
			path.join(repoDir, 'tasks.json'),
			JSON.stringify({
				tasks: [
					{ id: 'task-1', description: 'Make the code better', status: 'PENDING' },
				],
			})
		);

		process.chdir(repoDir);
		const result = await runTask({}, 'task-1');

		assert.deepStrictEqual(result, { ok: true, result: 'queued' }, 'handler should return the fix_project result');
		assert.deepStrictEqual(
			{
				...observedArgs,
				_cwd: fs.realpathSync.native(observedArgs._cwd),
			},
			{
				description: 'Make the code better',
				target: 'workspace',
				_taskId: 'task-1',
				_cwd: fs.realpathSync.native(repoDir),
			},
			'handler should delegate to fix_project with the current tasks.json context'
		);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(repoDir, { recursive: true, force: true });
	}

	console.log('Kanban run-task tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => {
	Module._load = originalLoad;
});
