const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log('Running tool runtime evidence tests...');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-runtime-evidence-'));
const logPath = path.join(tempDir, 'runtime.log');

fs.writeFileSync(logPath, [
	'2026-03-13T00:28:04.111Z [INFO] [Gemini] [gemini] [renderer] WebSocket closed: code=1007, reason=Request contains an invalid argument.',
	'2026-03-13T00:28:05.069Z [INFO] [Gemini] [gemini] [renderer] WebSocket closed: code=1011, reason=The service is currently unavailable.',
	'2026-03-13T00:28:08.201Z [INFO] [Voice] [voice] [renderer] User interrupted — playback stopped',
	'2026-03-13T00:28:11.020Z [INFO] [Voice] [voice] [renderer] Unprompted turn #2',
	'2026-03-13T00:28:11.024Z [INFO] [Voice] [voice] [renderer] Idle gate closed — blocking further idle output',
	'2026-03-13T00:28:22.637Z [INFO] [Vocab] [vocab] [renderer] Matcher built: 0 terms, 0 corrections',
	'2026-03-13T00:29:08.826Z [INFO] [Kanban] [ui] [main] Tasks file changed, notifying renderer',
].join('\n'));

process.env.IRIS_LOG_PATH = logPath;
const loggerPath = require.resolve('../src/main/logger.js');
delete require.cache[loggerPath];

let capturedSelfFixArgs = null;
const selfFixPath = require.resolve('../src/main/tools/self-fix.js');
require.cache[selfFixPath] = {
	id: selfFixPath,
	filename: selfFixPath,
	loaded: true,
	exports: {
		async self_fix(args) {
			capturedSelfFixArgs = args;
			return { ok: true, result: 'stub self_fix ran' };
		},
	},
};

const workspacePath = require.resolve('../src/main/workspace.js');
require.cache[workspacePath] = {
	id: workspacePath,
	filename: workspacePath,
	loaded: true,
	exports: {
		get() {
			return tempDir;
		},
		set(directory) {
			return { ok: true, result: directory };
		},
	},
};

const skillsPath = require.resolve('../src/main/skills.js');
require.cache[skillsPath] = {
	id: skillsPath,
	filename: skillsPath,
	loaded: true,
	exports: {
		getSkillContent() {
			return { ok: true, result: 'stubbed skill content' };
		},
		getHandler() {
			return null;
		},
	},
};

const toolIndexPath = require.resolve('../src/main/tools/index.js');
delete require.cache[toolIndexPath];
const toolExecutor = require('../src/main/tools/index.js');

const sampleLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
const summary = toolExecutor._private.summarizeRuntimeLogEvidence(sampleLines);
assert.match(summary, /Gemini invalid-argument closes/i);
assert.match(summary, /Gemini websocket instability/i);
assert.match(summary, /Idle loop churn/i);
assert.match(summary, /Runtime log source:/i);

const insights = toolExecutor._private.deriveRuntimeLogInsights(sampleLines);
assert.ok(insights.hypotheses.length >= 2, 'expected runtime log insights to propose hypotheses');
assert.ok(insights.experiments.length >= 2, 'expected runtime log insights to propose experiments');
assert.match(insights.hypotheses[0], /setup payload/i);

const promoted = toolExecutor._private.applyExecutionPolicy('open_app', {
	name: 'open YouTube and search for Theo',
});
assert.strictEqual(promoted.name, 'run_ui_task');
assert.strictEqual(promoted.args.goal, 'open YouTube and search for Theo');
assert.strictEqual(promoted.policy.kind, 'semantic_ui_promotion');

const review = toolExecutor._private.buildScientificSelfReview(
	'self_fix',
	{
		description: 'Investigate runtime logs and reduce tool latency.',
		self_review: true,
	},
	{ ok: true, result: 'Verified with targeted tests.' },
	420,
	{ kind: 'semantic_ui_promotion' },
);
assert.strictEqual(review.workflowStage, 'verified');
assert.strictEqual(review.route, 'semantic_ui_promotion');
assert.match(review.verification, /Verified with targeted tests/i);

const enriched = toolExecutor._private.enrichArgsWithScientificRuntimeEvidence('self_fix', {
	description: 'Analyze runtime logs and improve the AI Scientist execution loop.',
	target: 'iris',
});

assert.match(enriched.description, /RUNTIME LOG EVIDENCE:/);
assert.match(enriched.description, /Empty vocab refresh/i);
assert.strictEqual(enriched.scientific_metadata.workflow, 'ai_scientist_v1');
assert.ok(enriched.scientific_metadata.runtimeEvidence, 'expected runtime evidence metadata to be attached');
assert.match(enriched.scientific_metadata.runtimeEvidence.summary, /Playback interruption churn/i);
assert.ok(
	enriched.scientific_metadata.experimentPlan.some((step) => /degraded Gemini setup profile/i.test(step)),
	'expected runtime experiments to enrich the experiment plan',
);

(async () => {
	const result = await toolExecutor.execute('self_fix', {
		description: 'Analyze runtime logs and improve the AI Scientist execution loop.',
		target: 'iris',
	});

	assert.strictEqual(result.ok, true);
	assert.ok(capturedSelfFixArgs, 'expected the stub self_fix handler to receive args');
	assert.match(capturedSelfFixArgs.description, /RUNTIME LOG EVIDENCE:/);
	assert.match(capturedSelfFixArgs.description, /Empty vocab refresh/i);
	assert.strictEqual(capturedSelfFixArgs.scientific_metadata.workflowStage, 'hypothesis');

	console.log('Tool runtime evidence tests passed.');
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
