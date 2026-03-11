const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');
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
	const serviceRef = require('../src/main/automation/service-ref');
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

	manager.recordConversationTurn('user', 'you should stop asking me this every time');
	manager.recordConversationTurn('user', 'you should stop asking me this every time');
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
	.then(testGetDefaultAppUsesStoredMemory)
	.then(testLearningManagerWritesDefaultBrowserMemory)
	.then(testLearningManagerTracksDefaultAppQueryRecovery)
	.then(testLearningManagerRewritesDefaultAppQueryFromMemory)
	.then(testLearningManagerCreatesReusableToolSkill)
	.then(testLearningManagerExposesSafeMultiToolSequence)
	.then(testLearningManagerDedupesAutonomousSelfFix)
	.then(testPointerRecoveryDoesNotCreateLearnedSkill)
	.then(testSemanticIssueClusteringMergesNearDuplicateCoreGaps)
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
