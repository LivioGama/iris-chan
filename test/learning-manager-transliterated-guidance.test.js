const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const { MemoryStore } = require('../src/main/automation/memory-store');
const { LearningManager } = require('../src/main/automation/learning-manager');
const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-learning-transliterated-'));
}

function wait(ms = 40) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
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

	manager.recordConversationTurn('user', 'द फक व्हाट द फक एम आई सज टू इंफॉर्म ऑफ दैट');
	await wait(80);

	const policy = memoryStore.find({ key: 'policy.editor_self_improvement_generalization' });
	assert.ok(policy, 'transliterated anti-reask guidance should persist the reusable self-improvement policy');
	assert.match(
		String(policy.value?.message || ''),
		/generic way instead of fixing only the narrow case/i,
		'transliterated anti-reask guidance should map to the generic self-improvement behavior'
	);
	assert.strictEqual(selfFixCalls, 0, 'transliterated anti-reask guidance should not queue a generic self-fix');

	const issues = JSON.parse(fs.readFileSync(path.join(irisDir, 'self_fix_issues.json'), 'utf8'));
	assert.strictEqual(issues.issues.length, 0, 'transliterated anti-reask guidance should bypass the generic core-gap issue queue');

	console.log('transliterated guidance learning test passed');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
