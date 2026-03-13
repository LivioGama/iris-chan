const assert = require('node:assert');
const Module = require('node:module');

console.log('Running management correction dispatch tests...');

const originalLoad = Module._load;
let capturedFixProjectArgs = null;

const stubToolModules = new Set([
	'./input',
	'./apps',
	'./files',
	'./clipboard',
	'./search',
	'./system',
	'./vocab',
	'./self-fix',
	'./create-skill',
	'./input-meta',
	'./design',
	'./3d-gen',
	'./auth',
	'./fix-project',
	'./task-queue',
	'./ui-task',
	'./reply-assistant',
]);

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../logger') {
		return { info() {}, warn() {}, error() {} };
	}
	if (request === '../skills') {
		return {
			getHandler() { return null; },
			getSkillContent() { return { ok: false, result: 'unused' }; },
		};
	}
	if (request === '../workspace') {
		return {
			get() { return '/tmp/workspace'; },
			set() { return { ok: true }; },
		};
	}
	if (request === '../automation/service-ref') {
		return { getLearningManager() { return null; } };
	}
	if (request === '../coding/scientific-workflow') {
		return {
			applyScientificWorkflowDefaults(name, args = {}) {
				return { ...(args || {}), target: args?.target || 'iris' };
			},
			buildScientificTaskMetadata() {
				return {};
			},
		};
	}
	if (request === './fix-project') {
		return {
			fix_project: async (args = {}) => {
				capturedFixProjectArgs = args;
				return { ok: true, result: 'captured' };
			},
		};
	}
	if (stubToolModules.has(request)) {
		return {};
	}
	return originalLoad.apply(this, arguments);
};

const tools = require('../src/main/tools/index');
Module._load = originalLoad;

(async () => {
	const description = 'Apply management corrections based on explicit agent-relay output. Preserve execution-critical tasks, explicitly cancel cosmetic interaction task #abe1f98a, and restaff the missing P0 planning lanes by approving the first execution wave exactly as listed: workflow-eng (61fc130f), interaction-eng (45f2658b, 832c281b), platform-eng (c88b7d92, 2179b26f), and autonomy-eng (f82f293f).';
	const parsed = tools._private.parseManagementCorrections(description);

	assert.ok(parsed, 'parser should detect management correction text');
	assert.deepStrictEqual(
		parsed.cancellations.map((entry) => entry.taskId),
		['abe1f98a'],
		'parser should extract cancelled task id'
	);
	assert.deepStrictEqual(
		parsed.approvals,
		[
			{ agent: 'workflow-eng', taskIds: ['61fc130f'] },
			{ agent: 'interaction-eng', taskIds: ['45f2658b', '832c281b'] },
			{ agent: 'platform-eng', taskIds: ['c88b7d92', '2179b26f'] },
			{ agent: 'autonomy-eng', taskIds: ['f82f293f'] },
		],
		'parser should preserve the exact first-wave staffing list'
	);

	const result = await tools.execute('fix_project', { description });
	assert.strictEqual(result.ok, true, 'dispatch should succeed');
	assert.ok(capturedFixProjectArgs, 'dispatch should reach the fix_project handler');
	assert.match(capturedFixProjectArgs.description, /MANAGEMENT CORRECTIONS \(STRUCTURED\):/, 'dispatch should append structured management corrections');
	assert.match(capturedFixProjectArgs.description, /cancel task abe1f98a/i, 'dispatch should preserve the cancelled task id');
	assert.match(capturedFixProjectArgs.description, /approve tasks for interaction-eng: 45f2658b, 832c281b/i, 'dispatch should preserve multi-task staffing assignments');
	assert.match(capturedFixProjectArgs.description, /execute first-wave approvals exactly as listed: yes/i, 'dispatch should preserve exact-sequencing intent');

	console.log('Management correction dispatch tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
