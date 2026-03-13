const assert = require('node:assert');
const Module = require('node:module');

console.log('Running task queue watcher tests...');

const originalLoad = Module._load;
const executed = [];
const broadcasts = [];

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
	if (request === './executor') {
		return {
			executeTask: async (taskId, prompt, projectPath) => {
				executed.push({ taskId, prompt, projectPath });
				return { status: 'COMPLETED', summary: `done:${taskId}` };
			},
		};
	}
	if (request === '../coding/prompt') {
		return { buildCodingPrompt: ({ description, cwd }) => `PROMPT:${cwd}:${description}` };
	}
	return originalLoad.apply(this, arguments);
};

const watcher = require('../src/main/task-queue/watcher');
Module._load = originalLoad;

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
	const tasks = [
		{
			_id: 'a',
			projectPath: '/tmp/proj',
			rawPrompt: 'Task A',
			enrichedPrompt: 'Task A',
			impactedFiles: ['src/a.js'],
			status: 'queued',
			dependencies: [],
			inferredDependencies: [],
			blockedBy: [],
			dependencyState: 'ready',
			createdAt: 1,
			updatedAt: 1,
			resumable: true,
		},
		{
			_id: 'b',
			projectPath: '/tmp/proj',
			rawPrompt: 'Task B',
			enrichedPrompt: 'Task B',
			impactedFiles: ['src/b.js'],
			status: 'queued',
			dependencies: [],
			inferredDependencies: [],
			blockedBy: [],
			dependencyState: 'ready',
			createdAt: 2,
			updatedAt: 2,
			resumable: true,
		},
		{
			_id: 'c',
			projectPath: '/tmp/proj',
			rawPrompt: 'Follow-up to Task A',
			enrichedPrompt: 'Follow-up to Task A',
			impactedFiles: ['src/a.js'],
			status: 'queued',
			dependencies: [],
			inferredDependencies: [],
			blockedBy: [],
			dependencyState: 'ready',
			createdAt: 3,
			updatedAt: 3,
			resumable: true,
		},
		{
			_id: 17,
			projectPath: '/tmp/proj',
			rawPrompt: 'Resume me',
			status: 'running',
			dependencies: [],
			inferredDependencies: [],
			blockedBy: [],
			dependencyState: 'ready',
			createdAt: 0,
			updatedAt: 0,
			resumable: true,
			resumeCount: 0,
		},
	];

	const updates = [];
	const claims = [];
	const convex = {
		async getAllQueueTasks() {
			return { ok: true, value: tasks };
		},
		async updateQueueTask(id, patch) {
			updates.push({ id, patch });
			const task = tasks.find((entry) => entry._id === id);
			Object.assign(task, patch);
			return { ok: true };
		},
		async claimQueueTask(id, expectedStatuses, patch) {
			claims.push({ id, expectedStatuses, patch });
			const task = tasks.find((entry) => entry._id === id);
			if (!expectedStatuses.includes(task.status)) {
				return { ok: true, value: { ok: false, reason: 'status_mismatch' } };
			}
			Object.assign(task, patch);
			return { ok: true, value: { ok: true } };
		},
	};

	watcher.start(convex, { getDirectMode: () => false });
	await wait(75);
	watcher.stop();

	assert.ok(updates.some((entry) => entry.id === 17 && entry.patch.status === 'resuming'), 'running tasks should be recovered as resuming on startup');
	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === '17' && entry.payload.status === 'resuming'),
		'recovered tasks should broadcast the normalized task identifier on resume'
	);
	assert.ok(claims.some((entry) => entry.id === 'a'), 'first queued task should be claimed');
	assert.ok(claims.some((entry) => entry.id === 'b'), 'second same-project queued task should be claimed in parallel');
	assert.ok(!claims.some((entry) => entry.id === 'c'), 'blocked follow-up task should not be claimed');
	assert.ok(updates.some((entry) => entry.id === 'c' && entry.patch.status === 'blocked'), 'follow-up task should be marked blocked');
	assert.ok(executed.some((entry) => entry.taskId === 'a'), 'task A should execute');
	assert.ok(executed.some((entry) => entry.taskId === 'b'), 'task B should execute');
	assert.ok(!executed.some((entry) => entry.taskId === 'c'), 'blocked task should not execute');

	console.log('Task queue watcher tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
