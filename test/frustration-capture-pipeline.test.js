const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, beforeEach } = require('node:test');

const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-frustration-'));
}

function wait(ms = 50) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createManager(irisDir, overrides = {}) {
	const memoryStore = new MemoryStore({ irisDir });
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => ({ ok: true }),
		...overrides,
	});
	return { manager, memoryStore };
}

describe('frustration capture pipeline', () => {
	let irisDir;

	beforeEach(() => {
		irisDir = createTempDir();
	});

	it('creates a frustration task when user expresses a wish', async () => {
		const { manager } = createManager(irisDir);
		let taskCreated = false;
		let capturedOptions = null;

		// Mock createFrustrationQueuedTask
		const service = require('../src/main/task-queue/service');
		const original = service.createFrustrationQueuedTask;
		service.createFrustrationQueuedTask = async (options) => {
			taskCreated = true;
			capturedOptions = options;
			return { taskId: 'test-task-1', projectPath: '/test' };
		};

		try {
			manager.recordConversationTurn('user', 'I wish you could schedule meetings for me');
			await wait(200);

			assert.ok(taskCreated, 'frustration task should be created');
			assert.ok(capturedOptions.rawPrompt.includes('schedule meetings'), 'task summary should contain the feature description');
			assert.ok(capturedOptions.intake.frustration === true, 'intake should have frustration flag');
			assert.ok(capturedOptions.intake.frustrationSignals.includes('wish'), 'intake should have wish signal');
			assert.strictEqual(capturedOptions.intake.mode, 'frustration-capture', 'intake mode should be frustration-capture');
		} finally {
			service.createFrustrationQueuedTask = original;
		}
	});

	it('deduplicates the same frustration within 15 minutes', async () => {
		const { manager } = createManager(irisDir);
		let taskCount = 0;

		const service = require('../src/main/task-queue/service');
		const original = service.createFrustrationQueuedTask;
		service.createFrustrationQueuedTask = async () => {
			taskCount++;
			return { taskId: `test-task-${taskCount}`, projectPath: '/test' };
		};

		try {
			manager.recordConversationTurn('user', 'I wish you could read PDF files');
			await wait(200);
			assert.strictEqual(taskCount, 1, 'first frustration should create a task');

			manager.recordConversationTurn('user', 'I wish you could read PDF files');
			await wait(200);
			assert.strictEqual(taskCount, 1, 'duplicate frustration should NOT create another task');
		} finally {
			service.createFrustrationQueuedTask = original;
		}
	});

	it('creates separate tasks for different frustrations', async () => {
		const { manager } = createManager(irisDir);
		let taskCount = 0;
		const summaries = [];

		const service = require('../src/main/task-queue/service');
		const original = service.createFrustrationQueuedTask;
		service.createFrustrationQueuedTask = async (options) => {
			taskCount++;
			summaries.push(options.rawPrompt);
			return { taskId: `test-task-${taskCount}`, projectPath: '/test' };
		};

		try {
			manager.recordConversationTurn('user', 'I wish you could schedule meetings for me');
			await wait(200);

			manager.recordConversationTurn('user', "Why can't you handle multiple monitors properly");
			await wait(200);

			assert.strictEqual(taskCount, 2, 'different frustrations should create separate tasks');
			assert.ok(summaries[0].includes('schedule meetings'));
			assert.ok(summaries[1].includes('multiple monitors'));
		} finally {
			service.createFrustrationQueuedTask = original;
		}
	});

	it('does not create a frustration task for normal conversation', async () => {
		const { manager } = createManager(irisDir);
		let taskCreated = false;

		const service = require('../src/main/task-queue/service');
		const original = service.createFrustrationQueuedTask;
		service.createFrustrationQueuedTask = async () => {
			taskCreated = true;
			return { taskId: 'test-task', projectPath: '/test' };
		};

		try {
			manager.recordConversationTurn('user', 'Open Safari and go to Google');
			await wait(200);
			assert.ok(!taskCreated, 'normal commands should not create frustration tasks');
		} finally {
			service.createFrustrationQueuedTask = original;
		}
	});

	it('handles createFrustrationQueuedTask errors gracefully', async () => {
		const { manager } = createManager(irisDir);

		const service = require('../src/main/task-queue/service');
		const original = service.createFrustrationQueuedTask;
		service.createFrustrationQueuedTask = async () => {
			throw new Error('Convex unavailable');
		};

		try {
			// Should not throw
			manager.recordConversationTurn('user', 'I wish you could do magic tricks for me');
			await wait(200);
			assert.ok(true, 'should handle errors gracefully without throwing');
		} finally {
			service.createFrustrationQueuedTask = original;
		}
	});
});
