const assert = require('node:assert');

console.log('Running cooperative tool dispatch tests...');

const loggerPath = require.resolve('../src/main/logger.js');
require.cache[loggerPath] = {
	id: loggerPath,
	filename: loggerPath,
	loaded: true,
	exports: {
		LOG_PATH: '/tmp/iris-test.log',
		info() {},
		warn() {},
		error() {},
	},
};

const workspacePath = require.resolve('../src/main/workspace.js');
require.cache[workspacePath] = {
	id: workspacePath,
	filename: workspacePath,
	loaded: true,
	exports: {
		get() {
			return process.cwd();
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
			return { ok: true, result: 'stub skill' };
		},
		getHandler() {
			return null;
		},
	},
};

const serviceRefPath = require.resolve('../src/main/automation/service-ref.js');
require.cache[serviceRefPath] = {
	id: serviceRefPath,
	filename: serviceRefPath,
	loaded: true,
	exports: {
		getLearningManager() {
			return {
				resolveToolRequest(name, args) {
					if (name !== 'cooperative_first') return { name, args };
					return {
						name,
						args,
						sequenceRemainder: [{ name: 'cooperative_second', args: { step: 2 } }],
					};
				},
			};
		},
	},
};

const workflowPath = require.resolve('../src/main/coding/scientific-workflow.js');
require.cache[workflowPath] = {
	id: workflowPath,
	filename: workflowPath,
	loaded: true,
	exports: {
		applyScientificWorkflowDefaults(name, args) {
			return args || {};
		},
		buildScientificTaskMetadata() {
			return { workflow: 'ai_scientist_v1' };
		},
	},
};

const selfFixPath = require.resolve('../src/main/tools/self-fix.js');
const executionOrder = [];
require.cache[selfFixPath] = {
	id: selfFixPath,
	filename: selfFixPath,
	loaded: true,
	exports: {
		async cooperative_first() {
			executionOrder.push('first');
			return { ok: true, result: 'first' };
		},
		async cooperative_second() {
			executionOrder.push('second');
			return { ok: true, result: 'second' };
		},
	},
};

const toolIndexPath = require.resolve('../src/main/tools/index.js');
delete require.cache[toolIndexPath];
const toolExecutor = require('../src/main/tools/index.js');

(async () => {
	const tickOrder = [];
	setImmediate(() => {
		tickOrder.push('immediate');
	});

	const result = await toolExecutor.execute('cooperative_first', { hello: 'world' });

	assert.strictEqual(result.ok, true);
	assert.deepStrictEqual(executionOrder, ['first', 'second'], 'expected both tool handlers to run in order');
	assert.deepStrictEqual(
		tickOrder,
		['immediate'],
		'expected the event loop to run once between cooperative tool steps',
	);
	assert.strictEqual(typeof toolExecutor._private.yieldToEventLoop, 'function');

	console.log('Cooperative tool dispatch tests passed.');
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
