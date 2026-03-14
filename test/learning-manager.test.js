const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');
const { buildCodingPrompt } = require('../src/main/coding/prompt');
const serviceRef = require('../src/main/automation/service-ref');
const appsTools = require('../src/main/tools/apps');

console.log('Running learning manager tests...');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-learning-'));
}

function wait(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testMemoryStoreSeedsDefaultPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const policy = memoryStore.find({ key: 'policy.default_app_resolution' });
	assert.ok(policy, 'memory store should seed default app resolution policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'seeded default policy should be a fallback policy');
	const screenPolicy = memoryStore.find({ key: 'policy.screen_visibility_reassurance' });
	assert.ok(screenPolicy, 'memory store should seed screen visibility reassurance policy');
	assert.strictEqual(screenPolicy.kind, 'fallback_policy', 'screen visibility policy should be a fallback policy');
	const statusBarPolicy = memoryStore.find({ key: 'policy.status_bar_icon_visibility' });
	assert.ok(statusBarPolicy, 'memory store should seed status bar icon visibility policy');
	assert.strictEqual(statusBarPolicy.kind, 'fallback_policy', 'status bar icon visibility policy should be a fallback policy');
	const autonomousPolicy = memoryStore.find({ key: 'policy.autonomous_self_drive' });
	assert.ok(autonomousPolicy, 'memory store should seed autonomous self-drive policy');
	assert.strictEqual(autonomousPolicy.kind, 'fallback_policy', 'autonomous self-drive policy should be a fallback policy');
	const progressPolicy = memoryStore.find({ key: 'policy.progress_accountability' });
	assert.ok(progressPolicy, 'memory store should seed progress accountability policy');
	assert.strictEqual(progressPolicy.kind, 'fallback_policy', 'progress accountability policy should be a fallback policy');
	const taskHistoryPolicy = memoryStore.find({ key: 'policy.task_creation_accountability' });
	assert.ok(taskHistoryPolicy, 'memory store should seed task creation accountability policy');
	assert.strictEqual(taskHistoryPolicy.kind, 'fallback_policy', 'task creation accountability policy should be a fallback policy');
	const directTaskCreationPolicy = memoryStore.find({ key: 'policy.direct_task_creation' });
	assert.ok(directTaskCreationPolicy, 'memory store should seed direct task creation policy');
	assert.strictEqual(directTaskCreationPolicy.kind, 'fallback_policy', 'direct task creation policy should be a fallback policy');
	const editorGeneralizationPolicy = memoryStore.find({ key: 'policy.editor_self_improvement_generalization' });
	assert.ok(editorGeneralizationPolicy, 'memory store should seed editor self-improvement generalization policy');
	assert.strictEqual(editorGeneralizationPolicy.kind, 'fallback_policy', 'editor self-improvement policy should be a fallback policy');
	const executionPolicy = memoryStore.find({ key: 'policy.thorough_execution' });
	assert.ok(executionPolicy, 'memory store should seed thorough execution policy');
	assert.strictEqual(executionPolicy.kind, 'fallback_policy', 'thorough execution policy should be a fallback policy');
	const actionVerificationPolicy = memoryStore.find({ key: 'policy.action_verification' });
	assert.ok(actionVerificationPolicy, 'memory store should seed action-verification policy');
	assert.strictEqual(actionVerificationPolicy.kind, 'fallback_policy', 'action-verification policy should be a fallback policy');
	const presencePolicy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(presencePolicy, 'memory store should seed presence reassurance policy');
	assert.strictEqual(presencePolicy.kind, 'fallback_policy', 'presence reassurance policy should be a fallback policy');
	const creativePolicy = memoryStore.find({ key: 'policy.direct_creative_fulfillment' });
	assert.ok(creativePolicy, 'memory store should seed direct creative fulfillment policy');
	assert.strictEqual(creativePolicy.kind, 'fallback_policy', 'direct creative fulfillment policy should be a fallback policy');
	const cancellationPolicy = memoryStore.find({ key: 'policy.cancellation_closure' });
	assert.ok(cancellationPolicy, 'memory store should seed cancellation closure policy');
	assert.strictEqual(cancellationPolicy.kind, 'fallback_policy', 'cancellation closure policy should be a fallback policy');
}

async function testLearningManagerStoresScreenVisibilityReassurance() {
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

	manager.recordConversationTurn('user', 'डू यू सी माय SCREEN');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.screen_visibility_reassurance' });
	assert.ok(policy, 'screen visibility guidance should be stored as a memory policy');
	assert.match(String(policy.value?.message || ''), /periodic screenshots/i, 'stored guidance should preserve the screen visibility reassurance');
	assert.strictEqual(selfFixCalls, 0, 'screen visibility reassurance should not queue a core self-fix');
}

async function testLearningManagerStoresStatusBarIconVisibilityPolicy() {
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

	manager.recordConversationTurn('user', 'Now do you see a battery icon in the status bar');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.status_bar_icon_visibility' });
	assert.ok(policy, 'status bar icon guidance should be stored as a memory policy');
	assert.match(String(policy.value?.message || ''), /battery indicator/i, 'stored guidance should preserve the status bar icon visibility rule');
	assert.strictEqual(selfFixCalls, 0, 'status bar icon visibility guidance should not queue a core self-fix');
}

async function testLearningManagerWritesDefaultBrowserMemory() {
	const irisDir = createTempDir();
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
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	manager.recordConversationTurn('user', 'my default browser');
	manager.recordToolExecution('run_ui_task', { goal: 'open my default browser' }, 'Error: No accessibility element matched "my default browser"', false, 10);
	manager.recordToolExecution('open_app', { name: 'Safari' }, 'Opened Safari', true, 10);
	await wait(80);

	assert.strictEqual(
		memoryStore.getValue('environment.default_browser.app_name', ''),
		'Safari',
		'resolved default browser should be stored as environment memory'
	);
}

async function testLearningManagerTracksDefaultAppQueryRecovery() {
	const irisDir = createTempDir();
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
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	manager.recordConversationTurn('user', 'what is my default browser');
	manager.recordToolExecution('run_ui_task', { goal: 'what is my default browser' }, 'Error: Could not build deterministic plan', false, 10);
	manager.recordToolExecution('get_default_app', { kind: 'browser' }, 'Default browser app is Arc', true, 10);
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.default_app_resolution' });
	assert.ok(policy, 'default-app query recovery should keep the native default-app policy in memory');
}

async function testLearningManagerStoresPreClickPreparationPolicy() {
	const irisDir = createTempDir();
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
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	manager.recordConversationTurn('user', 'will need to run before you click right');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.pre_click_preparation' });
	assert.ok(policy, 'pre-click preparation guidance should become a stored fallback policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'pre-click preparation should be persisted as a fallback policy');
	assert.strictEqual(policy.value.enabled, true, 'stored pre-click preparation policy should be enabled');
}

async function testBuildCodingPromptIncludesAutonomousPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			description: 'Fix the autonomous loop.',
			cwd: irisDir,
			target: 'iris',
		});
		assert.match(prompt, /Learned autonomy policy:/, 'coding prompt should include the learned autonomy policy');
		assert.match(prompt, /Learned progress policy:/, 'coding prompt should include the learned progress policy');
		assert.match(prompt, /clear the remaining todo\/backlog/i, 'coding prompt should surface the autonomous backlog-clearing guidance');
		assert.match(prompt, /current task, concrete completed work, next step, and any blocker/i, 'coding prompt should surface the learned progress-accountability guidance');
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

async function testLearningManagerStoresProgressAccountabilityPolicy() {
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

	manager.recordConversationTurn('user', 'what are you doing and whats done already');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.progress_accountability' });
	assert.ok(policy, 'progress accountability guidance should be stored as a memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'progress accountability guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /current task, concrete completed work, next step, and any blocker/i);
	assert.strictEqual(selfFixCalls, 0, 'progress accountability guidance should not queue a core self-fix once learned as policy');
}

async function testLearningManagerStoresProgressAccountabilityPolicyFromBanglaScriptTransliteration() {
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

	manager.recordToolExecution('click_at', { x: 160, y: 90, capture_id: 'cap_progress' }, 'missed target', false, 9);
	manager.recordConversationTurn('user', 'হোয়াট আর ইউ ডুইং');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.progress_accountability' });
	assert.ok(policy, 'Bangla-script transliterated progress guidance should be learned as the progress-accountability policy');
	assert.match(String(policy.value?.message || ''), /current task, concrete completed work, next step, and any blocker/i);
	assert.strictEqual(selfFixCalls, 0, 'Bangla-script transliterated progress guidance should not queue a core self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'Bangla-script transliterated progress guidance should not create a generic core-gap issue');
}

async function testRepeatedPoemFrictionLearnsDirectCreativePolicyWithoutSelfFix() {
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

	await manager._applyCoreGapEvent({
		type: 'core-gap',
		domain: 'general',
		userText: 'टेल मी अ पोयम',
		guidanceText: 'टेल मी अ पोयम',
		classification: { payload: { description: 'User asked for a poem and Iris asked for clarification instead.' } },
		createdAt: new Date().toISOString(),
	});
	await wait(40);

	const policy = memoryStore.find({ key: 'policy.direct_creative_fulfillment' });
	assert.ok(policy, 'repeated poem friction should be converted into a reusable direct-creative policy');
	assert.match(
		String(policy.value?.message || ''),
		/short casual creative request such as asking for a poem/i,
		'stored creative policy should preserve direct fulfillment guidance'
	);
	assert.strictEqual(selfFixCalls, 0, 'direct creative friction should not queue another generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'poem friction should be learned as policy instead of a core-gap issue');
}

async function testLearningManagerStoresThoroughExecutionPolicy() {
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

	manager.recordToolExecution('click_at', { x: 320, y: 240, capture_id: 'cap_thorough' }, 'Clicked at (320,240)', true, 12);
	manager.recordConversationTurn('user', 'बेसरी गर्ने होला ल।');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.thorough_execution' });
	assert.ok(policy, 'terse do-it-properly guidance should be stored as a reusable memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'thorough execution guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /do it properly/i, 'stored execution policy should preserve the thorough-execution instruction');
	assert.strictEqual(selfFixCalls, 0, 'thorough execution guidance should not queue a core self-fix once learned as policy');
}

async function testLearningManagerTreatsDontHesitateAsThoroughExecutionPolicy() {
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

	manager.recordToolExecution('click_at', { x: 640, y: 320, capture_id: 'cap_decisive' }, 'Clicked at (640,320)', true, 11);
	manager.recordConversationTurn('user', "All right do it don't hesitate.");
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.thorough_execution' });
	assert.ok(policy, 'decisive follow-up guidance should be stored as the reusable thorough execution policy');
	assert.match(String(policy.value?.message || ''), /don't hesitate/i, 'stored execution policy should preserve the anti-hesitation instruction');
	assert.strictEqual(selfFixCalls, 0, 'decisive follow-up guidance should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'anti-hesitation guidance should not fall back to generic self-fix issue clustering');
}

async function testLearningManagerStoresPresenceReassurancePolicy() {
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

	manager.recordConversationTurn('user', 'हेलो कता हो साथी');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'presence reassurance guidance should be stored as a memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'presence reassurance guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /here and listening/i);
	assert.strictEqual(selfFixCalls, 0, 'presence reassurance guidance should not queue a core self-fix once learned as policy');
}

async function testGreetingPlusStatusPingLearnsPresencePolicyWithoutCoreGap() {
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

	manager.recordConversationTurn('assistant', 'Still working through the active task.');
	manager.recordConversationTurn('user', "Hello Iris what's going on");
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'greeting-plus-status ping should be stored as the presence reassurance policy');
	assert.match(String(policy.value?.message || ''), /here and listening|concise status update/i);
	assert.strictEqual(selfFixCalls, 0, 'greeting-plus-status ping should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'greeting-plus-status ping should not fall back to a generic nonpointer core-gap issue');
}

async function testCapabilityQuestionStaysBackgroundOnly() {
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

	manager.recordConversationTurn('assistant', 'How can I help?');
	manager.recordConversationTurn('user', 'what can you help me with');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.capability_overview_fulfillment' });
	assert.ok(policy, 'broad capability questions should be learned as capability-overview policy');
	assert.strictEqual(selfFixCalls, 0, 'broad capability questions should not queue autonomous self-fix during conversation');
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'broad capability questions should not create queued self-fix issues');
}

async function testIncompleteTurnCorrectionStaysBackgroundOnly() {
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

	manager.recordConversationTurn('assistant', 'I heard "What can you help me with". What would you like me to help with?');
	manager.recordConversationTurn('user', 'do nothing with that it was incomplete');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.partial_turn_background_handling' });
	assert.ok(policy, 'incomplete-turn corrections should be learned as a background handling policy');
	assert.strictEqual(selfFixCalls, 0, 'incomplete-turn corrections should not queue autonomous self-fix during conversation');
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'incomplete-turn corrections should not create queued self-fix issues');
}

async function testPlainGreetingLearnsPresencePolicyWithoutCoreGap() {
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

	manager.recordConversationTurn('user', 'हेलो');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'plain greeting should be stored as the presence reassurance policy');
	assert.match(String(policy.value?.message || ''), /here and listening/i);
	assert.strictEqual(selfFixCalls, 0, 'plain greeting should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'plain greeting should not fall back to a generic nonpointer core-gap issue');
}

async function testNoisyNepaliListeningPingLearnsPresencePolicy() {
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

	manager.recordConversationTurn('user', 'चिउरा सुनेको');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'short noisy Nepali listening guidance should be stored as the presence reassurance policy');
	assert.match(String(policy.value?.message || ''), /here and listening/i);
	assert.strictEqual(selfFixCalls, 0, 'short noisy Nepali listening guidance should not queue a core self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'short noisy Nepali listening guidance should not create a generic nonpointer core-gap issue');
}

async function testDevanagariHelloIrisVariantLearnsPresencePolicy() {
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

	manager.recordConversationTurn('user', 'हेलो एरिस आयरिश');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'Devanagari hello-Iris variant should be stored as the presence reassurance policy');
	assert.match(String(policy.value?.message || ''), /here and listening/i);
	assert.strictEqual(selfFixCalls, 0, 'Devanagari hello-Iris variant should not queue a core self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'Devanagari hello-Iris variant should not create a generic nonpointer core-gap issue');
}

async function testBareAssistantNamePingDuringActiveWorkLearnsPresencePolicy() {
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

	manager.recordToolExecution('run_ui_task', { goal: 'open that' }, 'Error: could not resolve visible target', false, 10);
	manager.recordToolExecution('click_at', { x: 318, y: 204, capture_id: 'cap_iris_ping' }, 'clicked visible item candidate', true, 12);
	manager.recordConversationTurn('assistant', 'I am opening the visible target now.');
	manager.recordConversationTurn('user', 'Iris');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.presence_reassurance' });
	assert.ok(policy, 'bare assistant-name ping during active work should update the presence reassurance policy');
	assert.match(
		String(policy.value?.message || ''),
		/treat it as a request for a concise status update/i,
		'presence policy should preserve active-work status handling for assistant attention pings'
	);
	assert.strictEqual(selfFixCalls, 0, 'bare assistant-name ping should learn presence behavior instead of queuing a self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'bare assistant-name ping should not create a generic pointer core-gap issue');

	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			cwd: irisDir,
			target: 'iris',
			description: 'Handle bare Iris attention pings during active work.',
		});
		assert.match(prompt, /Presence handling:/, 'coding prompt should include the presence handling rule');
		assert.match(
			prompt,
			/says your name by itself/i,
			'coding prompt should surface the bare-name presence-ping behavior'
		);
		assert.match(
			prompt,
			/concise status update/i,
			'coding prompt should preserve bare-name active-work status handling'
		);
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

async function testLearningManagerStoresTaskCreationAccountabilityPolicy() {
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

	manager.recordConversationTurn('user', 'टेल मी अबाउट ऑल द टास्क यू क्रिएटेड एंड एवरीथिंग इन दोस रिगार्ड्स फॉर दिस');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.task_creation_accountability' });
	assert.ok(policy, 'task-creation accountability guidance should be stored as a memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'task-creation accountability guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /task history instead of asking them to restate it/i);
	assert.match(String(policy.value?.message || ''), /Check tasks\.json when available/i);
	assert.strictEqual(selfFixCalls, 0, 'task-creation accountability guidance should not queue a core self-fix once learned as policy');
}

async function testLearningManagerStoresActionVerificationPolicyAndClustersSpecifically() {
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
	const guidance = 'you also need to have a verifikation of some sort because when i tell you to click at something currently you say you did or you even go as far as to say you already went to that page when you have not actually gone to that page and you sometimes use outdated screenshots';

	manager.recordToolExecution('click_at', { x: 512, y: 384, capture_id: 'cap_verify' }, 'Clicked at (512,384)', true, 12);
	manager.recordConversationTurn('user', guidance);
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.action_verification' });
	assert.ok(policy, 'action-verification friction should be stored as a reusable memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'action-verification guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /fresh screenshot/i, 'stored action-verification policy should require fresh evidence');
	assert.strictEqual(selfFixCalls, 0, 'single action-verification correction should learn policy before escalating');

	manager.recordConversationTurn('user', guidance);
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'repeated action-verification friction should cluster into one issue');
	assert.strictEqual(
		issues.issues[0].issueSignature,
		'core_gap:general:action_verification:screen_context+self_verification:none:none:pointer',
		'action-verification friction should map to the specific verification issue signature instead of the generic pointer bucket'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated action-verification friction should queue one self-fix');
}

async function testEditorSelfImprovementFrictionStoresReusablePolicy() {
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
	const guidance = 'you and I keep telling you to do stops and I keep teaching you if you feel can you modify your own code and in a generic way not in a specific problem solving way but you should be able to solve it generally broader range of problems that are like the problems that we just I\'ve just taught you can you do that already <noise>';

	manager.recordConversationTurn('user', guidance);
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.editor_self_improvement_generalization' });
	assert.ok(policy, 'editor self-improvement friction should be stored as a reusable memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'editor self-improvement friction should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /generic way instead of fixing only the narrow case/i);
	assert.strictEqual(selfFixCalls, 0, 'editor self-improvement friction should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'editor self-improvement guidance should not fall back to the generic core-gap issue queue');
}

async function testNepaliNoNeedToAskGuidanceStoresReusablePolicy() {
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

	manager.recordConversationTurn('user', 'के खाने हो पर्दैन नि');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.editor_self_improvement_generalization' });
	assert.ok(policy, 'Nepali "no need to ask again" friction should be stored as reusable editor-improvement policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'Nepali anti-reask guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /generic way instead of fixing only the narrow case/i);
	assert.strictEqual(selfFixCalls, 0, 'Nepali anti-reask guidance should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'Nepali anti-reask guidance should bypass the generic core-gap issue queue');
}

async function testPositiveFeedbackClosureGuidanceStoresReusablePolicy() {
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

	manager.recordConversationTurn('assistant', 'I updated the flow and reran the verification.');
	manager.recordConversationTurn('user', 'ओ दिस इज प्रीटी नाइस नाउ');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.positive_feedback_closure' });
	assert.ok(policy, 'short multilingual approval should be stored as reusable positive-feedback closure policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'positive-feedback closure guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /current direction worked/i);
	assert.strictEqual(selfFixCalls, 0, 'positive-feedback closure guidance should not queue a generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'positive-feedback closure guidance should not fall back to the generic nonpointer core-gap issue');
}

async function testCancellationClosureGuidanceStoresReusablePolicy() {
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

	manager.recordConversationTurn('assistant', 'I can keep trying, or I can stop here.');
	manager.recordConversationTurn('user', 'एवर माइंड ओके कैंसिलिंग वर्क्स');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.cancellation_closure' });
	assert.ok(policy, 'short multilingual cancellation acknowledgment should be stored as reusable cancellation-closure policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'cancellation closure guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /never mind|cancelling works/i);
	assert.strictEqual(selfFixCalls, 0, 'cancellation closure guidance should not queue a generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'cancellation closure guidance should not fall back to the generic nonpointer core-gap issue');
}

async function testLearningManagerRewritesDefaultAppQueryFromMemory() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	memoryStore.upsert({
		kind: 'environment_fact',
		scope: 'machine',
		key: 'environment.default_browser.app_name',
		value: 'Arc',
		source: 'observed_success',
		confidence: 1,
	});
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const resolved = manager.resolveToolRequest('get_default_app', { kind: 'browser' });

	assert.strictEqual(resolved.args.resolved_app_name, 'Arc', 'default-app query should be enriched from memory');
	assert.strictEqual(resolved.args.learned_from_memory, true, 'default-app query should be marked as memory-derived');
}

async function testGetDefaultAppUsesStoredMemory() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	memoryStore.upsert({
		kind: 'environment_fact',
		scope: 'machine',
		key: 'environment.default_browser.bundle_id',
		value: '',
		source: 'observed_success',
		confidence: 1,
	});
	memoryStore.upsert({
		kind: 'environment_fact',
		scope: 'machine',
		key: 'environment.default_browser.app_name',
		value: 'Arc',
		source: 'observed_success',
		confidence: 1,
	});
	const originalResolve = appsTools.resolveDefaultApp;
	appsTools.resolveDefaultApp = () => ({
		ok: true,
		kind: 'browser',
		bundleId: '',
		appName: 'Arc',
		source: 'memory',
	});
	try {
		const result = await appsTools.get_default_app({ kind: 'browser' });
		assert.strictEqual(result.ok, true, 'get_default_app should succeed');
		assert.strictEqual(result.app_name, 'Arc', 'get_default_app should expose the resolved app name');
		assert.strictEqual(result.source, 'memory', 'get_default_app should expose the resolution source');
	} finally {
		appsTools.resolveDefaultApp = originalResolve;
		serviceRef.setMemoryStore(previous);
	}
}

async function testLearningManagerCreatesReusableToolSkill() {
	const irisDir = createTempDir();
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
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	manager.recordConversationTurn('user', 'open my music app');
	manager.recordToolExecution('run_ui_task', { goal: 'open my music app' }, 'Error: Could not build a deterministic UI plan', false, 10);
	manager.recordToolExecution('open_app', { name: 'Music' }, 'Opened Music', true, 10);
	await wait(80);

	const resolved = manager.resolveToolRequest('open_app', { name: 'open my music app' });
	assert.strictEqual(resolved.args.name, 'Music', 'learned tool sequence should rewrite future vague tool calls');
	assert.ok(resolved.args.learned_skill_id, 'learned tool resolution should annotate the learned skill id');
}

async function testPlannerOpenThenPointerRecoveryLearnsPreparationPolicyInsteadOfSkill() {
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

	manager.recordConversationTurn('user', 'open that channel link');
	manager.recordToolExecution('run_ui_task', { goal: 'open that channel link' }, 'Error: Could not resolve visible target', false, 10);
	manager.recordToolExecution('open_app', { name: 'Safari' }, 'Opened Safari', true, 10);
	manager.recordToolExecution('click_at', { x: 510, y: 220, capture_id: 'cap_channel_link' }, 'Clicked the visible channel link', true, 10);
	await wait(120);

	const policy = memoryStore.find({ key: 'policy.pre_click_preparation' });
	assert.ok(policy, 'mixed planner/native/pointer recovery should learn a reusable preparation policy');
	assert.match(
		String(policy.value?.message || ''),
		/open or focus that app first, refresh the screen context/i,
		'preparation policy should preserve the app/window setup rule'
	);
	assert.match(
		String(policy.value?.evidence || policy.evidence || ''),
		/open that channel link/i,
		'preparation policy should preserve the triggering guidance'
	);
	const registry = selfImprovementManager.loadRegistry();
	assert.strictEqual(registry.skills.length, 0, 'pointer-assisted recovery should not create an unusable learned skill');
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(
		issues.issues.some((issue) => issue.issueSignature === 'core_gap:general:general:none:none:click_at+open_app+recovered+run_ui_task:pointer'),
		false,
		'native preparation recovery should not regress to the old generic issue bucket'
	);
	assert.strictEqual(selfFixCalls, 0, 'native preparation recovery should be learned without a core self-fix');
}

async function testPlannerPointerFailureThenOpenAppRecoveryLearnsPreparationPolicy() {
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

	manager.recordConversationTurn('user', 'open that channel link');
	manager.recordToolExecution('run_ui_task', { goal: 'open that channel link' }, 'Error: Could not resolve visible target', false, 10);
	manager.recordToolExecution('click_at', { x: 510, y: 220, capture_id: 'cap_channel_link' }, 'missed the visible channel link', false, 10);
	manager.recordToolExecution('open_app', { name: 'Safari' }, 'Opened Safari', true, 10);
	await wait(120);

	const policy = memoryStore.find({ key: 'policy.pre_click_preparation' });
	assert.ok(policy, 'failed-pointer then open_app recovery should still learn the preparation policy');
	assert.match(
		String(policy.value?.message || ''),
		/open or focus that app first, refresh the screen context/i,
		'preparation policy should preserve the app/window setup rule after failed pointer recovery'
	);
	assert.match(
		String(policy.value?.evidence || policy.evidence || ''),
		/open that channel link/i,
		'preparation policy should preserve the triggering guidance after failed pointer recovery'
	);
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(
		issues.issues.some((issue) => issue.issueSignature === 'core_gap:general:general:none:none:click_at+open_app+recovered+run_ui_task:pointer'),
		false,
		'failed-pointer then open_app recovery should not regress to the old generic issue bucket'
	);
	assert.strictEqual(selfFixCalls, 0, 'failed-pointer then open_app recovery should be learned without a core self-fix');
}

async function testFlattenedRecoveryIssueLearnsPreparationPolicyBeforeSelfFix() {
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

	manager.enqueue({
		type: 'core-gap',
		domain: 'general',
		issueSignature: 'core_gap:general:general:none:none:click_at+open_app+recovered+run_ui_task:pointer',
		userText: '',
		guidanceText: '',
		classification: {
			payload: {
				description: 'Recovered from run_ui_task, run_ui_task, click_at to open_app, open_app, open_app, self_fix after user guidance: .',
			},
		},
		failedTools: [],
		successfulTools: [],
		createdAt: new Date().toISOString(),
	});
	await wait(120);

	const policy = memoryStore.find({ key: 'policy.pre_click_preparation' });
	assert.ok(policy, 'flattened recovery issue should be converted into the reusable preparation policy');
	assert.match(
		String(policy.value?.message || ''),
		/open or focus that app first, refresh the screen context/i,
		'flattened recovery issue should preserve the app/window preparation rule'
	);
	assert.match(
		String(policy.value?.evidence || ''),
		/Recovered from run_ui_task, run_ui_task, click_at to open_app, open_app, open_app/i,
		'flattened recovery issue should preserve the original recovery evidence'
	);
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(
		issues.issues.some((issue) => issue.issueSignature === 'core_gap:general:general:none:none:click_at+open_app+recovered+run_ui_task:pointer'),
		false,
		'flattened recovery issue should not remain in the old generic self-fix bucket'
	);
	assert.strictEqual(selfFixCalls, 0, 'flattened recovery issue should learn natively before queuing another self-fix');
}

async function testLearningManagerExposesSafeMultiToolSequence() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const selfImprovementManager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	selfImprovementManager.createSkill({
		purpose: 'Open editor and save file',
		source_goal: 'save this file in code',
		trigger_source: 'user-correction',
		match_criteria: {
			intents: ['save this file in code'],
			keywords: ['save', 'code'],
		},
		preferred_execution_path: {
			type: 'tool-sequence',
			sequence: [
				{ name: 'open_app', args: { name: 'Visual Studio Code' } },
				{ name: 'press_key', args: { key: 'cmd+s' } },
			],
		},
		stability: 'stable',
	});
	const manager = new LearningManager({
		irisDir,
		memoryStore,
		selfImprovementManager,
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const resolved = manager.resolveToolRequest('open_app', { name: 'save this file in code' });

	assert.strictEqual(resolved.args.name, 'Visual Studio Code', 'first step of learned multi-tool sequence should rewrite the direct tool args');
	assert.strictEqual(Array.isArray(resolved.sequenceRemainder), true, 'learned multi-tool sequence should expose remaining safe steps');
	assert.strictEqual(resolved.sequenceRemainder.length, 1, 'remaining non-pointer steps should be preserved');
}

async function testLearningManagerDedupesAutonomousSelfFix() {
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

	manager.enqueue({
		type: 'core-gap',
		domain: 'general',
		userText: 'the same unsupported workflow keeps failing',
		guidanceText: 'the same unsupported workflow keeps failing',
		classification: { payload: { description: 'unsupported workflow keeps failing in the same way' } },
		createdAt: new Date().toISOString(),
	});
	manager.enqueue({
		type: 'core-gap',
		domain: 'general',
		userText: 'the same unsupported workflow keeps failing',
		guidanceText: 'the same unsupported workflow keeps failing',
		classification: { payload: { description: 'unsupported workflow keeps failing in the same way' } },
		createdAt: new Date().toISOString(),
	});
	await wait(120);

	assert.strictEqual(selfFixCalls, 1, 'repeated structural friction should queue one deduped self-fix');
}

async function testPointerRecoveryDoesNotCreateLearnedSkill() {
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

	manager.recordConversationTurn('user', 'open that channel link');
	manager.recordToolExecution('run_ui_task', { goal: 'open that channel link' }, 'Error: could not click result', false, 10);
	manager.recordToolExecution('click_at', { x: 10, y: 20 }, 'Clicked at (10,20)', true, 10);
	manager.recordConversationTurn('user', 'open that channel link');
	manager.recordToolExecution('run_ui_task', { goal: 'open that channel link' }, 'Error: could not click result', false, 10);
	manager.recordToolExecution('click_at', { x: 12, y: 24 }, 'Clicked at (12,24)', true, 10);
	await wait(120);

	const registry = JSON.parse(fs.readFileSync(path.join(irisDir, 'skills', '_registry.json'), 'utf8'));
	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(registry.skills.length, 0, 'pointer-only recovery should not become a learned skill');
	assert.strictEqual(selfFixCalls >= 1, true, 'repeated pointer-only recovery should escalate as stabilization debt');
	assert.strictEqual(
		issues.issues.some((issue) => String(issue.canonicalDescription || issue.issueSignature || '').includes('open that channel link')),
		true,
		'pointer-only recovery should record stabilization debt instead of a learned skill'
	);
}

async function testSemanticIssueClusteringMergesNearDuplicateCoreGaps() {
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

	manager.recordConversationTurn('user', 'Open that channel link');
	manager.recordConversationTurn('user', 'open that channel link');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'near-duplicate structural issues should cluster together');
	assert.strictEqual(issues.issues[0].semanticFeatures.intentFamily, 'navigation');
	assert.strictEqual(issues.issues[0].semanticFeatures.targets.includes('channel_result'), true);
	assert.strictEqual(selfFixCalls, 1, 'clustered repeated issue should trigger a single self-fix');
}

async function testAutonomousContinuationGuidanceStoresPolicyWithoutSelfFix() {
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

	manager.recordConversationTurn('user', 'ओके आई विल गेट बैक in a few hours until then keep working on this task and clear out all your to do');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.autonomous_self_drive' });
	assert.ok(policy, 'autonomous continuation guidance should be stored as a reusable policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'autonomous continuation guidance should persist as a fallback policy');
	assert.match(String(policy.value?.message || ''), /clear the remaining todo\/backlog/i);
	assert.strictEqual(selfFixCalls, 0, 'autonomous continuation guidance should not queue a core self-fix once learned as policy');
}

async function testScreenReferenceFrictionMapsToSpecificNativeIssue() {
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

	manager.recordConversationTurn('user', 'can you see my screen and click there too');
	manager.recordConversationTurn('user', 'can you see my screen and click there too');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'screen-reference friction should cluster into one issue');
	assert.strictEqual(
		issues.issues[0].issueSignature,
		'core_gap:general:screen_reference:screen_context+visible_target:none:none:nonpointer',
		'screen-reference friction should map to a specific screen-context issue signature'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('screen_context'),
		true,
		'screen-reference issue should preserve screen-context targeting'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('visible_target'),
		true,
		'screen-reference issue should preserve deictic visible-target guidance'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated screen-reference friction should queue one self-fix');
}

async function testFocusToggleFrictionMapsToVisibleControlIssue() {
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

	manager.recordToolExecution('click_at', { x: 640, y: 220, capture_id: 'cap_focus' }, 'clicked focus toggle candidate', true, 12);
	manager.recordConversationTurn('user', 'Do you see the focus toggle');
	manager.recordConversationTurn('user', 'Do you see the focus toggle');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'focus-toggle friction should cluster into one issue');
	assert.strictEqual(
		issues.issues[0].issueSignature,
		'core_gap:general:screen_reference:focus_toggle+screen_context+visible_target:none:none:pointer',
		'focus-toggle friction should map to a specific visible-control issue signature'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('focus_toggle'),
		true,
		'focus-toggle issue should preserve the visible control target'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('visible_target'),
		true,
		'focus-toggle issue should preserve visible-target semantics'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated focus-toggle friction should queue one self-fix');
}

async function testStatusBarBatteryFrictionMapsToStatusIconIssue() {
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

	manager.recordConversationTurn('user', 'Now do you see a battery icon in the status bar');
	manager.recordConversationTurn('user', 'Now do you see a battery icon in the status bar');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.status_bar_icon_visibility' });
	assert.ok(policy, 'status-bar battery guidance should be stored as a reusable memory policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'status-bar battery guidance should persist as a fallback policy');
	assert.match(
		String(policy.value?.message || ''),
		/status or menu bar icon such as the battery indicator/i,
		'status-bar battery policy should preserve the native icon-inspection guidance'
	);
	assert.strictEqual(selfFixCalls, 0, 'status-bar battery guidance should not queue a core self-fix once learned as policy');
}

async function testNoisyMultilingualPointerFrictionMapsToVisibleTargetIssue() {
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

	manager.recordToolExecution('click_at', { x: 512, y: 320, capture_id: 'cap_noise' }, 'clicked visible item candidate', true, 12);
	manager.recordConversationTurn('user', 'ไป <noise> ராமலிங்கம்');
	manager.recordConversationTurn('user', 'ไป <noise> ராமலிங்கம்');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'noisy multilingual pointer friction should cluster into one issue');
	assert.strictEqual(
		issues.issues[0].issueSignature,
		'core_gap:general:screen_reference:screen_context+visible_target:none:none:pointer',
		'noisy multilingual pointer friction should map to the native screen-reference issue instead of a generic noise bucket'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('visible_target'),
		true,
		'noisy multilingual pointer friction should preserve visible-target semantics'
	);
	assert.strictEqual(
		issues.issues[0].semanticFeatures.targets.includes('screen_context'),
		true,
		'noisy multilingual pointer friction should preserve screen-context semantics'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated noisy multilingual pointer friction should queue one deduped self-fix');
}

async function testOpaqueNepaliPointerRecoveryMapsToVisibleTargetIssue() {
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

	manager.recordToolExecution('run_ui_task', { goal: 'open that' }, 'Error: could not resolve visible target', false, 10);
	manager.recordConversationTurn('user', 'य ल ल');
	manager.recordToolExecution('click_at', { x: 412, y: 268, capture_id: 'cap_np_1' }, 'clicked visible item candidate', true, 12);
	await wait(80);
	manager.recordConversationTurn('user', 'य ल ल');
	manager.recordToolExecution('click_at', { x: 420, y: 272, capture_id: 'cap_np_2' }, 'clicked visible item candidate', true, 12);
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	const signatures = issues.issues.map((issue) => issue.issueSignature);
	assert.strictEqual(
		signatures.includes('core_gap:general:navigation:visible_target:none:none:pointer'),
		true,
		'opaque Nepali pointer recovery should produce a visible-target navigation issue instead of only the generic pointer bucket'
	);
	assert.strictEqual(
		signatures.includes('core_gap:general:general:none:none:none:pointer'),
		false,
		'opaque Nepali pointer recovery should not regress to the generic pointer issue signature'
	);
	const visibleTargetIssue = issues.issues.find((issue) => issue.issueSignature === 'core_gap:general:navigation:visible_target:none:none:pointer');
	assert.strictEqual(
		visibleTargetIssue?.semanticFeatures?.targets?.includes('visible_target'),
		true,
		'opaque Nepali pointer recovery should preserve visible-target semantics'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated opaque Nepali pointer recovery should queue one deduped self-fix');
}

async function testNoisyMultilingualScreenReferencePointerMapsToScreenReferenceIssue() {
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

	manager.recordToolExecution('run_ui_task', { goal: 'open that' }, 'Error: could not resolve visible target', false, 10);
	manager.recordToolExecution('click_at', { x: 468, y: 301, capture_id: 'cap_screen_ref_1' }, 'clicked visible item candidate', true, 12);
	manager.recordConversationTurn('user', 'एनसी में एक रेंट स्क्रीन');
	await wait(80);
	manager.recordConversationTurn('user', 'एनसी में एक रेंट स्क्रीन');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	const signatures = issues.issues.map((issue) => issue.issueSignature);
	assert.strictEqual(
		signatures.includes('core_gap:general:screen_reference:screen_context+visible_target:none:none:pointer'),
		true,
		'noisy multilingual screen-reference friction should map to the native screen-reference issue'
	);
	assert.strictEqual(
		signatures.includes('core_gap:general:general:none:none:none:pointer'),
		false,
		'noisy multilingual screen-reference friction should not regress to the generic pointer issue signature'
	);
	const screenReferenceIssue = issues.issues.find((issue) => issue.issueSignature === 'core_gap:general:screen_reference:screen_context+visible_target:none:none:pointer');
	assert.strictEqual(
		screenReferenceIssue?.semanticFeatures?.targets?.includes('screen_context'),
		true,
		'noisy multilingual screen-reference friction should preserve screen-context semantics'
	);
	assert.strictEqual(
		screenReferenceIssue?.semanticFeatures?.targets?.includes('visible_target'),
		true,
		'noisy multilingual screen-reference friction should preserve visible-target semantics'
	);
	assert.strictEqual(selfFixCalls >= 1, true, 'repeated noisy multilingual screen-reference friction should queue a self-fix for the learned native issue');
}

async function testSemanticIssueClusteringMergesParaphrasedFalsePositives() {
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

	manager.enqueue({
		type: 'false_positive_skill',
		domain: 'browser',
		userText: 'you opened youtube instead of the requested video',
		guidanceText: 'you opened youtube instead of the requested video',
		classification: { payload: { description: 'opened the wrong video target' } },
		failedTools: [{ name: 'run_ui_task', success: false }],
		successfulTools: [{ name: 'open_app', success: true }],
		createdAt: new Date().toISOString(),
	});
	manager.enqueue({
		type: 'false_positive_skill',
		domain: 'browser',
		userText: 'that opened youtube, not the video i asked for',
		guidanceText: 'that opened youtube, not the video i asked for',
		classification: { payload: { description: 'opened youtube instead of the requested video' } },
		failedTools: [{ name: 'get_default_app', success: false }],
		successfulTools: [{ name: 'open_app', success: true }],
		createdAt: new Date().toISOString(),
	});
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'paraphrased false positives should cluster together');
	assert.strictEqual(issues.issues[0].semanticFeatures.intentFamily, 'media_control');
	assert.strictEqual(issues.issues[0].semanticFeatures.targets.includes('video'), true);
	assert.strictEqual(selfFixCalls, 1, 'clustered false positives should trigger a single self-fix');
}

async function testSemanticIssueClusteringIgnoresToolPathVariance() {
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

	manager.enqueue({
		type: 'stabilization_candidate',
		domain: 'browser',
		userText: 'click the channel result',
		guidanceText: 'click the channel result',
		classification: { payload: { description: 'channel result needed pointer recovery' } },
		failedTools: [{ name: 'run_ui_task', success: false }],
		successfulTools: [{ name: 'click_at', success: true }],
		createdAt: new Date().toISOString(),
	});
	manager.enqueue({
		type: 'stabilization_candidate',
		domain: 'browser',
		userText: 'open the channel link',
		guidanceText: 'open the channel link',
		classification: { payload: { description: 'channel link needed pointer recovery' } },
		failedTools: [{ name: 'open_app', success: false }],
		successfulTools: [{ name: 'double_click', success: true }],
		createdAt: new Date().toISOString(),
	});
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'tool-path variants of the same channel target should cluster together');
	assert.strictEqual(issues.issues[0].semanticFeatures.targets.includes('channel_result'), true);
	assert.strictEqual(selfFixCalls, 1, 'clustered stabilization issues should trigger one self-fix');
}

async function testStabilizationFailureQueuesImmediateSelfFix() {
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

	manager.enqueue({
		type: 'stabilization_candidate',
		domain: 'browser',
		issueSignature: 'stabilize:click that channel',
		userText: 'click that channel link',
		guidanceText: 'click that channel link',
		classification: {
			payload: {
				issueSignature: 'stabilize:click that channel',
				description: 'Pointer rescue needs semantic stabilization',
			},
		},
		failedTools: [{ name: 'run_ui_task', success: false }],
		successfulTools: [{ name: 'click_at', success: true }],
		createdAt: new Date().toISOString(),
	});
	await wait(120);

	assert.strictEqual(selfFixCalls, 1, 'stabilization failure should queue self-fix immediately');
}

async function testDeferredSelfFixIssuesAreRetried() {
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

	manager.activeSelfFixCount = 3;
	manager.enqueue({
		type: 'core-gap',
		domain: 'system',
		issueSignature: 'issue:one',
		userText: 'first issue',
		guidanceText: 'first issue',
		classification: { payload: { description: 'first issue' } },
		createdAt: new Date().toISOString(),
		forceImmediate: true,
	});
	manager.enqueue({
		type: 'core-gap',
		domain: 'system',
		issueSignature: 'issue:two',
		userText: 'second issue',
		guidanceText: 'second issue',
		classification: { payload: { description: 'second issue' } },
		createdAt: new Date().toISOString(),
		forceImmediate: true,
	});
	await wait(80);

	const issuesBefore = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(
		issuesBefore.issues.some((issue) => issue.status === 'deferred'),
		true,
		'saturated self-fix queue should mark extra issues as deferred'
	);

	manager.activeSelfFixCount = 0;
	manager._pumpDeferredIssues();
	await wait(120);

	assert.strictEqual(selfFixCalls >= 1, true, 'deferred issue should eventually be retried');
}

Promise.resolve()
	.then(testMemoryStoreSeedsDefaultPolicy)
	.then(testLearningManagerStoresScreenVisibilityReassurance)
	.then(testLearningManagerStoresStatusBarIconVisibilityPolicy)
	.then(testGetDefaultAppUsesStoredMemory)
	.then(testLearningManagerWritesDefaultBrowserMemory)
	.then(testLearningManagerTracksDefaultAppQueryRecovery)
	.then(testLearningManagerStoresPreClickPreparationPolicy)
	.then(testLearningManagerStoresProgressAccountabilityPolicy)
	.then(testLearningManagerStoresProgressAccountabilityPolicyFromBanglaScriptTransliteration)
	.then(testRepeatedPoemFrictionLearnsDirectCreativePolicyWithoutSelfFix)
	.then(testLearningManagerStoresThoroughExecutionPolicy)
	.then(testLearningManagerTreatsDontHesitateAsThoroughExecutionPolicy)
	.then(testLearningManagerStoresPresenceReassurancePolicy)
	.then(testGreetingPlusStatusPingLearnsPresencePolicyWithoutCoreGap)
	.then(testCapabilityQuestionStaysBackgroundOnly)
	.then(testIncompleteTurnCorrectionStaysBackgroundOnly)
	.then(testNoisyNepaliListeningPingLearnsPresencePolicy)
	.then(testDevanagariHelloIrisVariantLearnsPresencePolicy)
	.then(testBareAssistantNamePingDuringActiveWorkLearnsPresencePolicy)
	.then(testLearningManagerStoresTaskCreationAccountabilityPolicy)
	.then(testLearningManagerStoresActionVerificationPolicyAndClustersSpecifically)
	.then(testEditorSelfImprovementFrictionStoresReusablePolicy)
	.then(testNepaliNoNeedToAskGuidanceStoresReusablePolicy)
	.then(testPositiveFeedbackClosureGuidanceStoresReusablePolicy)
	.then(testCancellationClosureGuidanceStoresReusablePolicy)
	.then(testBuildCodingPromptIncludesAutonomousPolicy)
	.then(testLearningManagerRewritesDefaultAppQueryFromMemory)
	.then(testLearningManagerCreatesReusableToolSkill)
	.then(testPlannerOpenThenPointerRecoveryLearnsPreparationPolicyInsteadOfSkill)
	.then(testPlannerPointerFailureThenOpenAppRecoveryLearnsPreparationPolicy)
	.then(testFlattenedRecoveryIssueLearnsPreparationPolicyBeforeSelfFix)
	.then(testLearningManagerExposesSafeMultiToolSequence)
	.then(testLearningManagerDedupesAutonomousSelfFix)
	.then(testPointerRecoveryDoesNotCreateLearnedSkill)
	.then(testSemanticIssueClusteringMergesNearDuplicateCoreGaps)
	.then(testAutonomousContinuationGuidanceStoresPolicyWithoutSelfFix)
	.then(testScreenReferenceFrictionMapsToSpecificNativeIssue)
	.then(testFocusToggleFrictionMapsToVisibleControlIssue)
	.then(testStatusBarBatteryFrictionMapsToStatusIconIssue)
	.then(testNoisyMultilingualPointerFrictionMapsToVisibleTargetIssue)
	.then(testOpaqueNepaliPointerRecoveryMapsToVisibleTargetIssue)
	.then(testNoisyMultilingualScreenReferencePointerMapsToScreenReferenceIssue)
	.then(testSemanticIssueClusteringMergesParaphrasedFalsePositives)
	.then(testSemanticIssueClusteringIgnoresToolPathVariance)
	.then(testStabilizationFailureQueuesImmediateSelfFix)
	.then(testDeferredSelfFixIssuesAreRetried)
	.then(() => {
		console.log('Learning manager tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
