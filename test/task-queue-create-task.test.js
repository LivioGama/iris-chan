const assert = require('node:assert');
const Module = require('node:module');

console.log('Running task queue create-task tests...');

const originalLoad = Module._load;
const broadcasts = [];
const createdTasks = [];
const updatedTasks = [];
let detectHoveredPathCalls = 0;
let workspacePath = '';

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../logger') {
		return { info() {}, warn() {}, error() {} };
	}
	if (request === '../windows/avatar-window' || request === '../windows/kanban-window') {
		return {
			get() {
				return {
					isDestroyed() { return false; },
					webContents: {
						id: request,
						send(channel, payload) {
							broadcasts.push({ channel, payload });
						},
					},
				};
			},
		};
	}
	if (request === '../task-queue/enricher') {
		return {
			enrichPrompt: async (prompt, projectPath) => ({
				enrichedPrompt: `ENRICHED:${prompt}`,
				impactedFiles: [`${projectPath}/file.js`],
				complexity: 'moderate',
				experimentPlan: 'experiment',
				explorationPlan: 'explore',
				verificationPlan: 'verify',
			}),
		};
	}
	if (request === '../task-queue/path-detector') {
		return {
			detectHoveredPath: async () => {
				detectHoveredPathCalls++;
				return { ok: true, projectPath: '/hovered/project' };
			},
		};
	}
	if (request === '../workspace') {
		return {
			get() {
				return workspacePath;
			},
		};
	}
	return originalLoad.apply(this, arguments);
};

const taskQueueService = require('../src/main/task-queue/service');
const taskQueueTool = require('../src/main/tools/task-queue');

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
	const storedTasks = [];
	const convex = {
		async createQueueTask(task) {
			createdTasks.push(task);
			const id = `task-${createdTasks.length}`;
			storedTasks.push({ _id: id, ...task });
			return { ok: true, value: id };
		},
		async updateQueueTask(id, patch) {
			updatedTasks.push({ id, patch });
			const existing = storedTasks.find((task) => String(task._id) === String(id));
			if (existing) Object.assign(existing, patch);
			return { ok: true };
		},
		async getAllQueueTasks() {
			return { ok: true, value: storedTasks };
		},
	};

	taskQueueService.setConvexClient(convex);
	taskQueueService.setBehaviorEngine({ getDirectMode: () => false });
	taskQueueTool.setConvexClient(convex);

	const result = await taskQueueTool.add_task({
		description: 'Add integration tests',
		target: 'workspace',
		auto_verify: true,
		self_review: true,
		dependencies: ['dep-1'],
		_countdownSeconds: 1,
		_countdownTickMs: 10,
	});

	assert.strictEqual(result.ok, true, 'tool should succeed');
	assert.strictEqual(result.taskId, 'task-1', 'tool should return created task id');
	assert.strictEqual(result.projectPath, '/hovered/project', 'tool should return resolved project path');
	assert.strictEqual(detectHoveredPathCalls, 1, 'tool should fall back to hovered path when workspace is unset');
	assert.deepStrictEqual(createdTasks[0].dependencies, ['dep-1'], 'tool should pass dependencies into shared create flow');
	assert.ok(!('autoVerify' in createdTasks[0]), 'tool-only scientific flags should not be persisted into the queue schema');
	assert.ok(!('scientificMetadata' in createdTasks[0]), 'scientific metadata should not be written to Convex queue records');
	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-1' && entry.payload.created === true),
		'tool-created task should broadcast immediate live creation update'
	);

	await wait(15);

	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-1' && entry.payload.enriched === true),
		'tool-created task should broadcast enrichment update'
	);

	await wait(25);

	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:countdown-state' && entry.payload.taskId === 'task-1' && entry.payload.remaining === 0),
		'shared countdown should broadcast countdown state for tool-created tasks'
	);
	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-1' && entry.payload.status === 'queued'),
		'shared countdown should broadcast queued transition for tool-created tasks'
	);

	workspacePath = '/workspace/project';
	const directBroadcastsStart = broadcasts.length;
	taskQueueService.setBehaviorEngine({ getDirectMode: () => true });
	const secondResult = await taskQueueTool.add_task({
		description: 'Use workspace path',
		target: 'workspace',
		_countdownSeconds: 1,
		_countdownTickMs: 10,
	});

	assert.strictEqual(secondResult.projectPath, '/workspace/project', 'workspace path should be preferred when available');
	await wait(15);
	assert.ok(
		broadcasts.slice(directBroadcastsStart).some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-2' && entry.payload.status === 'queued'),
		'direct mode should immediately broadcast queued status for tool-created tasks'
	);

	console.log('Task queue create-task tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => {
	Module._load = originalLoad;
});
