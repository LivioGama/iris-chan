const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, beforeEach } = require('node:test');

const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { LearningClassifier } = require('../src/main/automation/learning-classifier');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-frustration-e2e-'));
}

function wait(ms = 50) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('frustration capture end-to-end', () => {
	let irisDir;
	const service = require('../src/main/task-queue/service');
	let originalCreateFn;

	beforeEach(() => {
		irisDir = createTempDir();
		originalCreateFn = service.createFrustrationQueuedTask;
	});

	it('full pipeline: user wish → classifier → manager → task created', async () => {
		const classifier = new LearningClassifier();
		const text = 'I wish you could schedule meetings for me';

		// Step 1: Classifier detects frustration
		const classification = classifier.classifyConversation(text);
		assert.ok(classification, 'classifier should return a result');
		assert.strictEqual(classification.type, 'frustration');
		assert.ok(classification.payload.summary.includes('schedule meetings'));
		assert.ok(classification.payload.signals.includes('wish'));

		// Step 2: Manager routes to task creation
		const createdTasks = [];
		service.createFrustrationQueuedTask = async (options) => {
			createdTasks.push(options);
			return { taskId: `e2e-task-${createdTasks.length}`, projectPath: '/test' };
		};

		const memoryStore = new MemoryStore({ irisDir });
		const selfImprovementManager = new SelfImprovementManager({
			irisDir,
			skillsEngine: { scan() { return []; } },
			selfFixTool: async () => ({ ok: true }),
		});
		const manager = new LearningManager({
			irisDir,
			memoryStore,
			selfImprovementManager,
			selfFixTool: async () => ({ ok: true }),
		});

		manager.recordConversationTurn('user', text);
		await wait(300);

		assert.strictEqual(createdTasks.length, 1, 'exactly one task should be created');
		assert.ok(createdTasks[0].rawPrompt.includes('schedule meetings'));
		assert.strictEqual(createdTasks[0].intake.frustration, true);
		assert.deepStrictEqual(createdTasks[0].intake.frustrationSignals, ['wish']);
		assert.strictEqual(createdTasks[0].intake.mode, 'frustration-capture');

		service.createFrustrationQueuedTask = originalCreateFn;
	});

	it('full pipeline: why-cant complaint → task created with correct signals', async () => {
		const createdTasks = [];
		service.createFrustrationQueuedTask = async (options) => {
			createdTasks.push(options);
			return { taskId: `e2e-task-${createdTasks.length}`, projectPath: '/test' };
		};

		const memoryStore = new MemoryStore({ irisDir });
		const selfImprovementManager = new SelfImprovementManager({
			irisDir,
			skillsEngine: { scan() { return []; } },
			selfFixTool: async () => ({ ok: true }),
		});
		const manager = new LearningManager({
			irisDir,
			memoryStore,
			selfImprovementManager,
			selfFixTool: async () => ({ ok: true }),
		});

		manager.recordConversationTurn('user', "Why can't you handle multiple browser tabs");
		await wait(300);

		assert.strictEqual(createdTasks.length, 1);
		assert.ok(createdTasks[0].rawPrompt.includes('handle multiple browser tabs'));
		assert.ok(createdTasks[0].intake.frustrationSignals.includes('why-cant'));

		service.createFrustrationQueuedTask = originalCreateFn;
	});

	it('dedup prevents duplicate tasks across the 15-minute window', async () => {
		const createdTasks = [];
		service.createFrustrationQueuedTask = async (options) => {
			createdTasks.push(options);
			return { taskId: `e2e-task-${createdTasks.length}`, projectPath: '/test' };
		};

		const memoryStore = new MemoryStore({ irisDir });
		const selfImprovementManager = new SelfImprovementManager({
			irisDir,
			skillsEngine: { scan() { return []; } },
			selfFixTool: async () => ({ ok: true }),
		});
		const manager = new LearningManager({
			irisDir,
			memoryStore,
			selfImprovementManager,
			selfFixTool: async () => ({ ok: true }),
		});

		// Same frustration twice
		manager.recordConversationTurn('user', 'I wish you could send emails for me');
		await wait(300);
		manager.recordConversationTurn('user', 'I wish you could send emails for me');
		await wait(300);

		assert.strictEqual(createdTasks.length, 1, 'duplicate should be deduped');

		// Different frustration should go through
		manager.recordConversationTurn('user', "Why don't you support clipboard history");
		await wait(300);

		assert.strictEqual(createdTasks.length, 2, 'different frustration should create new task');

		service.createFrustrationQueuedTask = originalCreateFn;
	});

	it('non-frustration text does not create frustration tasks', async () => {
		const createdTasks = [];
		service.createFrustrationQueuedTask = async (options) => {
			createdTasks.push(options);
			return { taskId: `e2e-task-${createdTasks.length}`, projectPath: '/test' };
		};

		const memoryStore = new MemoryStore({ irisDir });
		const selfImprovementManager = new SelfImprovementManager({
			irisDir,
			skillsEngine: { scan() { return []; } },
			selfFixTool: async () => ({ ok: true }),
		});
		const manager = new LearningManager({
			irisDir,
			memoryStore,
			selfImprovementManager,
			selfFixTool: async () => ({ ok: true }),
		});

		manager.recordConversationTurn('user', 'Open the browser please');
		await wait(300);
		manager.recordConversationTurn('user', 'What time is it right now?');
		await wait(300);
		manager.recordConversationTurn('user', 'Thanks that looks great');
		await wait(300);

		assert.strictEqual(createdTasks.length, 0, 'non-frustration text should not create tasks');

		service.createFrustrationQueuedTask = originalCreateFn;
	});

	it('assistant turns are ignored for frustration detection', async () => {
		const createdTasks = [];
		service.createFrustrationQueuedTask = async (options) => {
			createdTasks.push(options);
			return { taskId: `e2e-task-${createdTasks.length}`, projectPath: '/test' };
		};

		const memoryStore = new MemoryStore({ irisDir });
		const selfImprovementManager = new SelfImprovementManager({
			irisDir,
			skillsEngine: { scan() { return []; } },
			selfFixTool: async () => ({ ok: true }),
		});
		const manager = new LearningManager({
			irisDir,
			memoryStore,
			selfImprovementManager,
			selfFixTool: async () => ({ ok: true }),
		});

		// Assistant saying frustration-like text should not trigger
		manager.recordConversationTurn('model', 'I wish I could help with scheduling meetings');
		await wait(300);

		assert.strictEqual(createdTasks.length, 0, 'assistant turns should not create frustration tasks');

		service.createFrustrationQueuedTask = originalCreateFn;
	});
});
