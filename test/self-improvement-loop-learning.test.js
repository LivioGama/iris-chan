const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const serviceRef = require('../src/main/automation/service-ref');
const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');
const { buildCodingPrompt } = require('../src/main/coding/prompt');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-self-improvement-loop-'));
}

function wait(ms = 40) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	console.log('Running self-improvement loop learning test...');
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	let selfFixCalls = 0;
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => {
			selfFixCalls += 1;
			return { ok: true, result: 'queued core self-fix' };
		},
	});

	manager.recordConversationTurn('user', 'All right so what else do you have to do after that to self improve');
	manager.recordConversationTurn('user', 'All right so what else do you have to do after that to self improve');
	await wait(150);

	const policy = memoryStore.find({ key: 'policy.autonomous_self_drive' });
	assert.ok(policy, 'self-improvement follow-up guidance should update the autonomous self-drive policy');
	assert.match(
		String(policy.value?.message || ''),
		/determine the next improvement step yourself/i,
		'policy should preserve the self-improvement continuation rule'
	);
	assert.strictEqual(selfFixCalls, 0, 'self-improvement follow-up guidance should not queue another generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'self-improvement follow-up guidance should be learned as policy instead of a core-gap issue');

	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
	const prompt = buildCodingPrompt({
			cwd: irisDir,
			target: 'iris',
			description: 'Continue self-improving after each verification result.',
		});
		assert.match(prompt, /Learned autonomy policy:/, 'coding prompt should include the learned autonomy policy');
		assert.match(
			prompt,
			/determine the next improvement step yourself/i,
			'coding prompt should surface the learned self-improvement loop guidance'
		);
	} finally {
		serviceRef.setMemoryStore(previous);
	}

	console.log('self-improvement loop learning test passed');
}

async function testConflictResolutionContinuationGuidanceLearnsPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	let selfFixCalls = 0;
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => {
			selfFixCalls += 1;
			return { ok: true, result: 'queued core self-fix' };
		},
	});

	manager.recordToolExecution('click_at', { x: 320, y: 180, capture_id: 'cap_conflict_1' }, 'opened diff view', true, 15);
	manager.recordConversationTurn('user', 'ओके रिजॉल्व दोस कॉन्फ्लिक्ट विदाउट ओवर रेडिंग इदर ऑफ द चेंजेस एंड कंटिन्यू');
	manager.recordConversationTurn('user', 'ओके रिजॉल्व दोस कॉन्फ्लिक्ट विदाउट ओवर रेडिंग इदर ऑफ द चेंजेस एंड कंटिन्यू');
	await wait(150);

	const policy = memoryStore.find({ key: 'policy.conflict_resolution_continuation' });
	assert.ok(policy, 'conflict-resolution continuation guidance should persist a reusable policy');
	assert.match(
		String(policy.value?.message || ''),
		/light-touch comparison/i,
		'policy should preserve the light-touch conflict resolution behavior'
	);
	assert.strictEqual(selfFixCalls, 0, 'conflict-resolution continuation guidance should learn policy before escalating a self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'conflict-resolution continuation guidance should not create a generic core-gap issue');

	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			cwd: irisDir,
			target: 'iris',
			description: 'Resolve the current conflicts and keep going.',
		});
		assert.match(prompt, /Learned conflict-resolution policy:/, 'coding prompt should include the learned conflict-resolution policy');
		assert.match(
			prompt,
			/resolve conflicts without over-reading either change/i,
			'coding prompt should surface the learned conflict-resolution continuation rule'
		);
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

async function testBenchmarkTaskCreationGuidanceLearnsPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	let selfFixCalls = 0;
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => {
			selfFixCalls += 1;
			return { ok: true, result: 'queued core self-fix' };
		},
	});

	manager.recordConversationTurn('user', 'Can you can you add a task to get the performance benchmarks of Iris');
	manager.recordConversationTurn('user', 'Can you can you add a task to get the performance benchmarks of Iris');
	await wait(150);

	const policy = memoryStore.find({ key: 'policy.direct_task_creation' });
	assert.ok(policy, 'direct benchmark-task guidance should persist a reusable task-creation policy');
	assert.match(
		String(policy.value?.message || ''),
		/create the task directly/i,
		'policy should preserve the direct task-creation behavior'
	);
	assert.strictEqual(selfFixCalls, 0, 'direct task-creation guidance should not queue a generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'direct task-creation guidance should be learned as policy instead of a core-gap issue');

	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			cwd: irisDir,
			target: 'iris',
			description: 'Handle direct add-task requests for benchmark work without asking the user to restate them.',
		});
		assert.match(prompt, /Learned task-creation policy:/, 'coding prompt should include the learned direct task-creation policy');
		assert.match(
			prompt,
			/add, create, or queue a task and the requested work is clear, create it directly/i,
			'coding prompt should surface the direct task-creation rule'
		);
		assert.match(
			prompt,
			/collecting Iris performance benchmarks/i,
			'coding prompt should explicitly coach benchmark-task follow-ups'
		);
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

main()
	.then(() => testConflictResolutionContinuationGuidanceLearnsPolicy())
	.then(() => testBenchmarkTaskCreationGuidanceLearnsPolicy())
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
