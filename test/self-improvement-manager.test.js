const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const {
	SelfImprovementManager,
	DEFAULT_INFERENCE_POLICY,
	DEFAULT_QUESTION_POLICY,
	DEFAULT_STEERING_DECISION_TYPES,
	normalizeExecutionLane,
	inferHireableProfile,
} = require('../src/main/automation/self-improvement-manager');

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
	const createdEntry = registry.skills.find((entry) => entry.id === result.skillId);
	assert.deepStrictEqual(
		createdEntry.capabilityBundle,
		['fulfill_request', 'adjacent_follow_up_readiness'],
		'createSkill should persist the default capability bundle'
	);
	assert.strictEqual(
		createdEntry.inferencePolicy,
		DEFAULT_INFERENCE_POLICY,
		'createSkill should persist the default inference policy'
	);
	assert.strictEqual(
		createdEntry.questionPolicy,
		DEFAULT_QUESTION_POLICY,
		'createSkill should persist the default question policy'
	);
	assert.deepStrictEqual(
		createdEntry.steeringDecisionTypes,
		DEFAULT_STEERING_DECISION_TYPES,
		'createSkill should persist the default steering-decision types'
	);
	assert.ok(fs.existsSync(path.join(irisDir, 'skills', 'skill-author', 'SKILL.md')), 'meta skill should be installed automatically');
}

async function testImageSkillInfersAnticipatoryBundle() {
	const irisDir = createTempDir();
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const result = manager.createSkill({
		purpose: 'Create an image for a landing page hero',
		source_goal: 'create an image',
	});

	const registry = readJson(path.join(irisDir, 'skills', '_registry.json'));
	const createdEntry = registry.skills.find((entry) => entry.id === result.skillId);
	assert.ok(createdEntry.capabilityBundle.includes('edit'), 'image skill bundle should include edit capability');
	assert.ok(createdEntry.capabilityBundle.includes('revise'), 'image skill bundle should include revise capability');
	assert.ok(
		createdEntry.steeringDecisionTypes.includes('provider_choice'),
		'image skill bundle should allow one provider-choice steering decision when blocked'
	);
	assert.strictEqual(
		createdEntry.questionPolicy,
		'zero_questions',
		'image skill bundle should default to zero-question behavior when a reasonable default exists'
	);
}

async function testDedicatedLanePersistsHireableProfile() {
	const irisDir = createTempDir();
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const result = manager.createSkill({
		purpose: 'Persist runtime evidence and summarize regressions',
		source_goal: 'capture runtime evidence for regressions',
		lane: 'research/observability',
	});

	const registry = readJson(path.join(irisDir, 'skills', '_registry.json'));
	const createdEntry = registry.skills.find((entry) => entry.id === result.skillId);
	assert.strictEqual(createdEntry.executionLane, 'research-observability', 'dedicated execution lanes should normalize to the canonical research-observability lane');
	assert.strictEqual(createdEntry.hireableProfile, 'observability-researcher', 'research-observability lane should default to the observability hireable profile');
	assert.strictEqual(createdEntry.hireable, true, 'dedicated non-core lanes should be marked hireable');
	assert.ok(createdEntry.capabilityBundle.includes('runtime_analysis'), 'research-observability lane should pick the lane-specific capability bundle');
	assert.strictEqual(normalizeExecutionLane('research/observability'), 'research-observability', 'lane aliases should normalize consistently');
	assert.strictEqual(inferHireableProfile({}, 'memory'), 'memory-architect', 'memory lane should infer the memory hireable profile');
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

async function testLegacySkillReplacementAddsDefaultPolicies() {
	const irisDir = createTempDir();
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const registryPath = path.join(irisDir, 'skills', '_registry.json');
	fs.mkdirSync(path.dirname(registryPath), { recursive: true });
	fs.writeFileSync(registryPath, JSON.stringify({
		version: 1,
		updatedAt: new Date().toISOString(),
		skills: [{
			id: 'legacy-skill',
			name: 'legacy-skill',
			baseName: 'legacy-skill',
			slug: 'legacy-skill',
			description: 'Create an image',
			status: 'active',
			version: 1,
			activeVersion: 1,
			path: path.join(irisDir, 'skills', 'legacy-skill'),
			origin: 'user-requested',
			stability: 'stable',
			domain: 'general',
			routingPriority: 100,
			demotionCount: 0,
			match: {
				appNames: [],
				intents: ['create an image'],
				keywords: ['create', 'image'],
				preconditions: [],
			},
			preferredExecutionPath: { type: 'ui-plan', plan: { goal: 'create an image', appHint: '', steps: [{ type: 'openApp', appName: 'Preview' }] } },
			fallbackPath: null,
			lineage: { replaces: null, replacedBy: null },
			stats: { successCount: 0, failureCount: 0, lastOutcome: 'created', lastUsedAt: null },
			failureWindow: [],
			replacementHistory: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}],
		patterns: [],
	}, null, 2), 'utf8');

	const match = manager.findMatchingSkill({ goal: 'create an image', appHint: '' });
	assert.ok(match, 'legacy skill entries without new metadata should remain routable');

	const replaced = manager.replaceSkill(match);
	assert.deepStrictEqual(
		replaced.capabilityBundle,
		['create', 'edit', 'revise', 'generate_variants', 'export'],
		'legacy skill replacement should lazily upgrade to the inferred anticipatory bundle'
	);
	assert.strictEqual(
		replaced.inferencePolicy,
		DEFAULT_INFERENCE_POLICY,
		'legacy skill replacement should adopt the default inference policy'
	);
	assert.strictEqual(
		replaced.questionPolicy,
		DEFAULT_QUESTION_POLICY,
		'legacy skill replacement should adopt the default question policy'
	);
}

async function testReplacementPreservesExistingBundleMetadata() {
	const irisDir = createTempDir();
	const manager = new SelfImprovementManager({
		irisDir,
		skillsEngine: { scan() { return []; } },
		selfFixTool: async () => ({ ok: true, result: 'queued core self-fix' }),
	});

	const created = manager.createSkill({
		purpose: 'Draft a blog post',
		source_goal: 'draft a blog post',
		capability_bundle: ['draft', 'revise', 'format'],
		inference_policy: DEFAULT_INFERENCE_POLICY,
		question_policy: DEFAULT_QUESTION_POLICY,
		steering_decision_types: ['provider_choice'],
	});
	const registry = readJson(path.join(irisDir, 'skills', '_registry.json'));
	const original = registry.skills.find((entry) => entry.id === created.skillId);
	const replaced = manager.replaceSkill(original);

	assert.deepStrictEqual(
		replaced.capabilityBundle,
		['draft', 'revise', 'format'],
		'replacement should preserve an existing bundle instead of re-inferring it'
	);
	assert.deepStrictEqual(
		replaced.steeringDecisionTypes,
		['provider_choice'],
		'replacement should preserve the existing steering-decision policy'
	);
}

Promise.resolve()
	.then(testCreateSkillWritesPackageAndRegistry)
	.then(testImageSkillInfersAnticipatoryBundle)
	.then(testDedicatedLanePersistsHireableProfile)
	.then(testRepeatedPatternPromotesToLearnedSkill)
	.then(testCoreLaneEscalatesToSelfFix)
	.then(testLegacySkillReplacementAddsDefaultPolicies)
	.then(testReplacementPreservesExistingBundleMetadata)
	.then(() => {
		console.log('Self-improvement manager tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
