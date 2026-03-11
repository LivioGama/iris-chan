const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const { SelfImprovementManager } = require('../src/main/automation/self-improvement-manager');

console.log('Running self-improvement manager tests...');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-self-improve-'));
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function testCreateSkillWritesPackageAndRegistry() {
	const irisDir = createTempDir();
	let scanCount = 0;
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { scanCount += 1; return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const result = manager.createSkill({
		purpose: 'Go back in Safari history',
		app_scope: 'Safari',
		trigger_source: 'failure-driven',
		source_goal: 'go back in my browser',
		preferred_execution_path: {
			type: 'ui-plan',
			plan: {
				goal: 'go back in my browser',
				appHint: 'Safari',
				successSignal: '',
				steps: [{ type: 'navigateHistory', appHint: 'Safari', direction: 'back' }],
			},
		},
	});

	assert.strictEqual(result.ok, true, 'createSkill should succeed');
	assert.strictEqual(scanCount >= 1, true, 'createSkill should refresh the skill catalog');
	assert.ok(fs.existsSync(result.path), 'skill package directory should exist');
	assert.ok(fs.existsSync(path.join(result.path, 'SKILL.md')), 'skill package should include SKILL.md');
	assert.ok(fs.existsSync(path.join(result.path, 'metadata.json')), 'skill package should include metadata.json');
	assert.ok(fs.existsSync(path.join(result.path, 'scripts', 'run.js')), 'skill package should include a runner script');

	const registry = readJson(path.join(irisDir, 'skills', '_registry.json'));
	assert.strictEqual(Array.isArray(registry.skills), true, 'registry should track skills');
	assert.strictEqual(registry.skills.some((entry) => entry.id === result.skillId), true, 'registry should include the new skill');
	assert.ok(fs.existsSync(path.join(irisDir, 'skills', 'skill-author', 'SKILL.md')), 'meta skill should be installed automatically');
}

async function testRepeatedPatternPromotesToLearnedSkill() {
	const irisDir = createTempDir();
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});
	const plan = {
		goal: 'Search for Theo and click first channel result',
		appHint: 'Safari',
		successSignal: 'Theo',
		steps: [
			{ type: 'searchInCurrentContext', appHint: 'Safari', query: 'Theo' },
			{ type: 'clickSearchResult', appHint: 'Safari', resultKind: 'channel', position: 1 },
		],
	};

	manager.recordSuccessfulPlan({ goal: plan.goal, appHint: 'Safari', plan, usedLearnedSkill: false });
	const created = manager.recordSuccessfulPlan({ goal: plan.goal, appHint: 'Safari', plan, usedLearnedSkill: false });

	assert.ok(created && created.ok === true, 'repeated pattern should create a learned skill on the second success');
	const match = manager.findMatchingSkill({ goal: 'search for theo and click first channel result', appHint: 'Safari' });
	assert.ok(match, 'created learned skill should be routable');
	assert.strictEqual(match.match.appNames.includes('Safari'), true, 'learned skill should stay app-scoped');
}

async function testCoreLaneEscalatesToSelfFix() {
	const irisDir = createTempDir();
	let invoked = false;
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async (args) => {
			invoked = true;
			return { ok: true, result: args.description };
		},
	});

	const result = await manager.createSkill({
		lane: 'core',
		description: 'Modify Iris planner globally rather than creating a local skill package.',
	});

	assert.strictEqual(invoked, true, 'core lane should delegate to self_fix');
	assert.strictEqual(result.ok, true, 'core lane should return the self_fix result');
}

Promise.resolve()
	.then(testCreateSkillWritesPackageAndRegistry)
	.then(testRepeatedPatternPromotesToLearnedSkill)
	.then(testCoreLaneEscalatesToSelfFix)
	.then(() => {
		console.log('Self-improvement manager tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
