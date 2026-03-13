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

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-learning-pointer-'));
}

function wait(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testMemoryStoreSeedsScreenReferencePolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const policy = memoryStore.find({ key: 'policy.screen_reference_direct_action' });
	assert.ok(policy, 'memory store should seed screen-reference direct-action policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'screen-reference direct-action policy should be a fallback policy');
	assert.match(String(policy.value?.message || ''), /readable on-screen label or text/i, 'seeded screen-reference policy should instruct Iris to use visible text around the target');
}

async function testBuildCodingPromptIncludesScreenReferencePolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			description: 'Fix generic pointer guidance learning.',
			cwd: irisDir,
			target: 'iris',
		});
		assert.match(prompt, /Learned screen-reference policy:/, 'coding prompt should include the learned screen-reference policy');
		assert.match(prompt, /screen-referential request/i, 'coding prompt should surface the screen-reference direct-action behavior');
		assert.match(prompt, /readable nearby labels\/text/i, 'coding prompt should tell Iris to use visible labels and text before asking again');
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

async function testOpaqueNepaliPointerCorrectionLearnsVisibleTextScreenReferencePolicy() {
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

	manager.recordToolExecution('run_ui_task', { goal: 'open what is written there' }, 'Error: could not resolve visible target', false, 10);
	manager.recordConversationTurn('user', 'यो लेख्छ जस्तो बुझेन भन्दै नै।');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.screen_reference_direct_action' });
	assert.ok(policy, 'opaque Nepali pointer correction should still learn the reusable screen-reference policy');
	assert.match(String(policy.value?.evidence || ''), /यो लेख्छ जस्तो बुझेन भन्दै नै/u, 'stored screen-reference policy should preserve the exact user guidance');
	assert.strictEqual(selfFixCalls, 0, 'single opaque Nepali pointer correction should learn natively before escalating');
}

async function testOpaquePointerCorrectionLearnsScreenReferencePolicyAndClustersSpecifically() {
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
	manager.recordToolExecution('click_at', { x: 44, y: 88, capture_id: 'cap_1' }, 'missed candidate target', false, 10);
	manager.recordConversationTurn('user', 'ఇది నగత బస్సు కొండ మరి');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.screen_reference_direct_action' });
	assert.ok(policy, 'opaque pointer correction should persist a reusable screen-reference policy');
	assert.match(String(policy.value?.message || ''), /visible target/i, 'stored policy should preserve the visible-target behavior');
	assert.strictEqual(selfFixCalls, 0, 'single opaque pointer correction should learn policy before escalating');

	manager.recordConversationTurn('user', 'ఇది నగత బస్సు కొండ మరి');
	await wait(120);

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 1, 'opaque pointer corrections should cluster into one issue');
	assert.strictEqual(
		issues.issues[0].issueSignature,
		'core_gap:general:screen_reference:screen_context+visible_target:none:none:pointer',
		'opaque pointer corrections should map to the native screen-reference issue signature'
	);
	assert.strictEqual(selfFixCalls, 1, 'repeated opaque pointer correction should queue one self-fix');
}

async function main() {
	console.log('Running learning pointer guidance tests...');
	await testMemoryStoreSeedsScreenReferencePolicy();
	await testBuildCodingPromptIncludesScreenReferencePolicy();
	await testOpaqueNepaliPointerCorrectionLearnsVisibleTextScreenReferencePolicy();
	await testOpaquePointerCorrectionLearnsScreenReferencePolicyAndClustersSpecifically();
	console.log('learning pointer guidance tests passed');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
