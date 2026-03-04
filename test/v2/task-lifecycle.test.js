const assert = require('node:assert');
require('ts-node').register({ transpileOnly: true });
const { TaskEngine, classifyRestart } = require('../../src/main/tasks/task-engine');
const { RuntimeEventBus } = require('../../src/shared/event-bus');

console.log('Running V2 task lifecycle tests...');

{
	assert.strictEqual(classifyRestart(['src/main/tools/auth.js']), 'hot', 'tools-only change should be hot restart');
	assert.strictEqual(classifyRestart(['src/renderer/app.js']), 'cold', 'core renderer change should be cold restart');
}

{
	const bus = new RuntimeEventBus();
	const milestones = [];
	bus.on('event', (evt) => milestones.push(evt));
	const engine = new TaskEngine({
		eventBus: bus,
		convexClient: { saveTaskMilestone: async () => ({ ok: true }) },
	});

	const run = engine.runTask('task-x', { filesTouched: ['src/main/tools/index.js'] });
	assert.strictEqual(run.ok, true, 'runTask should return ok');
	assert.strictEqual(run.restartClass, 'hot', 'runTask returns restart class');

	engine.completeTask('task-x', 'done');
	assert.ok(milestones.some((evt) => evt.type === 'TASK_DONE'), 'TASK_DONE event emitted');
}

console.log('V2 task lifecycle tests passed.');
