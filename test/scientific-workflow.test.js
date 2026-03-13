const assert = require('node:assert');

const {
	applyScientificWorkflowDefaults,
	buildScientificTaskMetadata,
	buildScientificMethodGuide,
} = require('../src/main/coding/scientific-workflow');

console.log('Running scientific workflow tests...');

const defaults = applyScientificWorkflowDefaults('fix_project', {
	description: '  Improve the active task execution loop and verify with logs.  ',
});

assert.strictEqual(defaults.description, 'Improve the active task execution loop and verify with logs.');
assert.strictEqual(defaults.scientific_workflow, 'ai_scientist_v1');
assert.strictEqual(defaults.auto_verify, true);
assert.strictEqual(defaults.self_review, true);
assert.strictEqual(defaults.consider_containerization, true);
assert.ok(defaults.scientific_metadata, 'scientific defaults should inject metadata');
assert.strictEqual(defaults.scientific_metadata.workflowStage, 'hypothesis');

const metadata = buildScientificTaskMetadata({
	description: 'Implement a faster autonomous coding loop.',
	target: 'iris',
	projectPath: '/tmp/iris',
});
assert.strictEqual(metadata.workflow, 'ai_scientist_v1');
assert.strictEqual(metadata.objective, 'Implement a faster autonomous coding loop.');
assert.strictEqual(metadata.reproducibility.considerRestartRequirements, true);
assert.ok(metadata.experimentPlan.length >= 3);

const guide = buildScientificMethodGuide();
assert.match(guide, /AI Scientist workflow:/);
assert.match(guide, /hyper-parameter/i);
assert.match(guide, /self-review/i);

console.log('Scientific workflow tests passed.');
