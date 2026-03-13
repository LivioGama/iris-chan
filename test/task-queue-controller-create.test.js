const assert = require('node:assert');
const Module = require('node:module');

require('ts-node').register({ transpileOnly: true });

console.log('Running task queue controller create-task tests...');

const handlers = new Map();
const originalLoad = Module._load;
const calls = [];

const taskQueueServiceMock = {
	setConvexClient() {},
	setBehaviorEngine() {},
	async createQueuedTask(args) {
		calls.push({ kind: 'create', args });
		const projectPath = await args.resolveProjectPath();
		return { taskId: 'queue-1', projectPath };
	},
	async approveQueuedTask(taskId) {
		calls.push({ kind: 'approve', taskId });
		return { ok: true };
	},
	async cancelQueuedTask(taskId) {
		calls.push({ kind: 'cancel', taskId });
		return { ok: true };
	},
	getConvexClient() {
		return {
			getAllQueueTasks: async () => ({ ok: true, value: [] }),
			getQueueTasksByProject: async (projectPath) => ({ ok: true, value: [projectPath] }),
		};
	},
};

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
	if (request === '../logger') {
		return { info() {}, warn() {}, error() {} };
	}
	if (request === '../task-queue/service') {
		return taskQueueServiceMock;
	}
	if (request === '../task-queue/path-detector') {
		return {
			detectHoveredPath: async () => ({ ok: true, projectPath: '/detected/project' }),
		};
	}
	return originalLoad.apply(this, arguments);
};

const controller = require('../src/main/controllers/taskQueueController');
controller.register();

(async () => {
	const createHandler = handlers.get('tq:create-task');
	assert.ok(createHandler, 'create-task handler should be registered');

	const createResult = await createHandler({}, 'Fix live Kanban');
	assert.deepStrictEqual(
		createResult,
		{ ok: true, taskId: 'queue-1', projectPath: '/detected/project' },
		'create handler should return the shared service result'
	);
	assert.strictEqual(calls[0].kind, 'create', 'controller should delegate task creation to shared service');
	assert.strictEqual(calls[0].args.origin, 'ipc:create-task', 'controller should preserve IPC origin');
	assert.strictEqual(calls[0].args.rawPrompt, 'Fix live Kanban', 'controller should pass the raw prompt through');

	const approveHandler = handlers.get('tq:approve-task');
	const cancelHandler = handlers.get('tq:cancel-task');
	assert.ok(approveHandler, 'approve handler should be registered');
	assert.ok(cancelHandler, 'cancel handler should be registered');

	await approveHandler({}, 'queue-1');
	await cancelHandler({}, 'queue-2');

	assert.ok(calls.some((entry) => entry.kind === 'approve' && entry.taskId === 'queue-1'), 'approve handler should use shared service');
	assert.ok(calls.some((entry) => entry.kind === 'cancel' && entry.taskId === 'queue-2'), 'cancel handler should use shared service');

	console.log('Task queue controller create-task tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => {
	Module._load = originalLoad;
});
