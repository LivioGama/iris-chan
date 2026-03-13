const assert = require('node:assert');
const Module = require('node:module');

console.log('Running task queue create-task tests...');

const originalLoad = Module._load;
const broadcasts = [];
const createdTasks = [];
const updatedTasks = [];
const warnings = [];
let detectHoveredPathCalls = 0;
let workspacePath = '';

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../logger') {
		return {
			info() {},
			warn(scope, message) {
				warnings.push({ scope, message });
			},
			error() {},
		};
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
			enrichPrompt: async (prompt, projectPath) => {
				if (prompt === 'Fail enrichment') {
					throw new Error('flash offline');
				}
				return {
					enrichedPrompt: `ENRICHED:${prompt}`,
					impactedFiles: [`${projectPath}/file.js`],
					complexity: 'moderate',
					experimentPlan: 'experiment',
					explorationPlan: 'explore',
					verificationPlan: 'verify',
				};
			},
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
		execution_lane: 'memory',
		hireable_profile: 'memory-architect',
		queue_bucket: 'policy-memory',
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
	assert.strictEqual(createdTasks[0].taskKind, 'coding', 'default queue tasks should persist their normalized task kind');
	assert.strictEqual(createdTasks[0].executionLane, 'memory', 'tool-created tasks should persist the selected execution lane');
	assert.strictEqual(createdTasks[0].hireableProfile, 'memory-architect', 'tool-created tasks should persist the selected hireable profile');
	assert.strictEqual(createdTasks[0].execution.lastEvent, 'created', 'default queue tasks should persist execution bookkeeping');
	assert.strictEqual(createdTasks[0].execution.executionLane, 'memory', 'execution bookkeeping should carry the normalized lane');
	assert.strictEqual(createdTasks[0].execution.hireableProfile, 'memory-architect', 'execution bookkeeping should carry the hireable profile');
	assert.strictEqual(createdTasks[0].execution.queueBucket, 'policy-memory', 'execution bookkeeping should carry the queue bucket');
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
	assert.ok(
		updatedTasks.some((entry) => entry.id === 'task-1' && entry.patch.enrichedPrompt === 'ENRICHED:Add integration tests' && entry.patch.dependencyState === 'ready'),
		'enrichment should persist deterministic ready-state patch before approval'
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
	assert.ok(
		!broadcasts.slice(directBroadcastsStart).some((entry) => entry.channel === 'tq:countdown-state' && entry.payload.taskId === 'task-2'),
		'direct mode should skip countdown broadcasts entirely'
	);

	taskQueueService.setBehaviorEngine({ getDirectMode: () => false });
	const failedEnrichmentResult = await taskQueueTool.add_task({
		description: 'Fail enrichment',
		target: 'workspace',
		_countdownSeconds: 1,
		_countdownTickMs: 10,
	});

	assert.strictEqual(failedEnrichmentResult.taskId, 'task-3', 'failed enrichment path should still create a queue task');
	await wait(15);
	assert.ok(
		warnings.some((entry) => /Enrichment failed for task-3: flash offline/.test(entry.message)),
		'enrichment failures should be logged with task id and reason'
	);
	assert.ok(
		!broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-3' && entry.payload.enriched === true),
		'failed enrichment should not emit a misleading enriched update'
	);

	await wait(20);
	assert.ok(
		broadcasts.some((entry) => entry.channel === 'tq:task-update' && entry.payload.taskId === 'task-3' && entry.payload.status === 'queued'),
		'failed enrichment should still transition deterministically into queued state after countdown'
	);

	const voiceResult = await taskQueueService.createVoiceQueuedTask({
		rawPrompt: 'Fix the flaky login flow',
		utterance: 'please fix the flaky login flow in the app',
		projectPath: '/voice/project',
		origin: 'voice:test',
		confidence: 0.87,
		appHint: 'Arc',
		countdownSeconds: 1,
		countdownTickMs: 10,
	});
	assert.strictEqual(voiceResult.taskId, 'task-4', 'voice helper should create a queue task');
	assert.strictEqual(createdTasks[3].taskKind, 'voice', 'voice helper should persist voice task kind');
	assert.strictEqual(createdTasks[3].executionLane, 'memory', 'voice helper should route to the memory lane');
	assert.strictEqual(createdTasks[3].hireableProfile, 'memory-architect', 'voice helper should use the memory hireable profile');
	assert.strictEqual(createdTasks[3].intake.source, 'voice', 'voice helper should persist intake source');
	assert.strictEqual(createdTasks[3].intake.utterance, 'please fix the flaky login flow in the app', 'voice helper should persist the source utterance');

	const frustrationResult = await taskQueueService.createFrustrationQueuedTask({
		summary: 'Safari upload button keeps failing',
		utterance: 'this upload button keeps failing in Safari',
		projectPath: '/voice/project',
		origin: 'voice:test',
		signals: ['repeat-request', 'negative-sentiment'],
		countdownSeconds: 1,
		countdownTickMs: 10,
	});
	assert.strictEqual(frustrationResult.taskId, 'task-5', 'frustration helper should create a queue task');
	assert.strictEqual(createdTasks[4].taskKind, 'frustration', 'frustration helper should persist frustration task kind');
	assert.strictEqual(createdTasks[4].executionLane, 'research-observability', 'frustration helper should route to the research-observability lane');
	assert.strictEqual(createdTasks[4].hireableProfile, 'observability-researcher', 'frustration helper should use the observability hireable profile');
	assert.strictEqual(createdTasks[4].intake.frustration, true, 'frustration helper should persist frustration flag');
	assert.deepStrictEqual(createdTasks[4].intake.frustrationSignals, ['repeat-request', 'negative-sentiment'], 'frustration helper should persist frustration signals');

	console.log('Task queue create-task tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => {
	Module._load = originalLoad;
});
