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

console.log('Running terminal log observability learning tests...');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-terminal-logs-'));
}

function wait(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testMemoryStoreSeedsTerminalLogPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const policy = memoryStore.find({ key: 'policy.terminal_log_observability' });
	assert.ok(policy, 'memory store should seed terminal log observability policy');
	assert.strictEqual(policy.kind, 'fallback_policy', 'terminal log observability policy should be a fallback policy');
	assert.match(String(policy.value?.message || ''), /runtime logs|terminal output/i, 'seeded policy should preserve terminal log guidance');
}

async function testLearningManagerStoresTerminalLogPolicy() {
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

	manager.recordConversationTurn('user', 'सो आई एम कंसर्न अबाउट द टर्मिनल डू यू सी ऑल दोस रन टाइम लॉग्स');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.terminal_log_observability' });
	assert.ok(policy, 'terminal runtime-log guidance should be stored as a memory policy');
	assert.match(String(policy.value?.message || ''), /visible terminal\/log pane/i, 'stored policy should preserve terminal pane inspection guidance');
	assert.strictEqual(selfFixCalls, 0, 'terminal runtime-log guidance should not queue a core self-fix once learned as policy');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'terminal runtime-log guidance should not fall back to generic issue clustering');
}

async function testCodingPromptIncludesTerminalLogPolicy() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	try {
		const prompt = buildCodingPrompt({
			description: 'Improve Iris terminal awareness.',
			cwd: irisDir,
			target: 'iris',
		});
		assert.match(prompt, /Learned terminal-observability policy:/, 'coding prompt should include the learned terminal observability policy');
		assert.match(prompt, /runtime logs|console lines/i, 'coding prompt should surface terminal log guidance');
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

async function main() {
	await testMemoryStoreSeedsTerminalLogPolicy();
	await testLearningManagerStoresTerminalLogPolicy();
	await testCodingPromptIncludesTerminalLogPolicy();
	console.log('terminal log observability learning tests passed');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
