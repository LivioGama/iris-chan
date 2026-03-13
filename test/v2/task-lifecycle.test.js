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
	const stream = [];
	bus.on('event', (evt) => milestones.push(evt));
	const engine = new TaskEngine({
		eventBus: bus,
		convexClient: { saveTaskMilestone: async () => ({ ok: true }) },
	});
	engine.subscribeStream((evt) => stream.push(evt));

	const run = engine.runTask('task-x', { filesTouched: ['src/main/tools/index.js'] });
	assert.strictEqual(run.ok, true, 'runTask should return ok');
	assert.strictEqual(run.restartClass, 'hot', 'runTask returns restart class');

	engine.completeTask('task-x', 'done');
	assert.ok(milestones.some((evt) => evt.type === 'TASK_DONE'), 'TASK_DONE event emitted');
	assert.ok(stream.some((evt) => evt.taskId === 'task-x' && evt.type === 'done' && evt.status === 'completed'), 'task stream should emit completion');
}

{
	const bus = new RuntimeEventBus();
	const events = [];
	const stream = [];
	bus.on('event', (evt) => events.push(evt));
	const engine = new TaskEngine({ eventBus: bus });
	engine.subscribeStream((evt) => stream.push(evt));

	engine.runTask('task-verify', {
		filesTouched: ['src/renderer/app.js'],
		requiresPostVerification: true,
	});

	const blocked = engine.completeTask('task-verify', 'should block');
	assert.strictEqual(blocked.ok, false, 'verification-required tasks should not complete before verification');
	assert.match(blocked.error, /Completion blocked until post-change verification passes/);
	assert.ok(events.some((evt) => evt.type === 'TASK_MILESTONE' && /blocked until post-change verification passes/i.test(evt.payload.message)), 'blocked completion should emit milestone evidence');
	assert.ok(stream.some((evt) => evt.taskId === 'task-verify' && evt.type === 'milestone' && /blocked until post-change verification passes/i.test(evt.message)), 'blocked completion should emit milestone on task stream');
	assert.ok(!events.some((evt) => evt.type === 'TASK_DONE' && evt.payload.taskId === 'task-verify'), 'blocked completion should not emit TASK_DONE');

	const verified = engine.markVerified('task-verify', 'Verification passed cleanly');
	assert.strictEqual(verified.ok, true, 'markVerified should succeed for running task');
	assert.ok(stream.some((evt) => evt.taskId === 'task-verify' && evt.type === 'milestone' && evt.message === 'Verification passed cleanly'), 'verification evidence should be mirrored onto task stream');

	const completed = engine.completeTask('task-verify', 'done after verification');
	assert.strictEqual(completed.ok, true, 'verified task should complete cleanly');
	assert.ok(events.some((evt) => evt.type === 'TASK_DONE' && evt.payload.taskId === 'task-verify' && evt.payload.message === 'done after verification'), 'verified completion should emit TASK_DONE');
	assert.ok(stream.some((evt) => evt.taskId === 'task-verify' && evt.type === 'done' && evt.status === 'completed' && evt.summary === 'done after verification'), 'verified completion should emit done event on task stream');

	engine.runTask('task-force', { requiresPostVerification: true });
	const forced = engine.completeTask('task-force', 'forced done', { force: true });
	assert.strictEqual(forced.ok, true, 'force option should bypass verification gate');
	assert.ok(events.some((evt) => evt.type === 'TASK_DONE' && evt.payload.taskId === 'task-force' && evt.payload.message === 'forced done'), 'forced completion should still emit TASK_DONE');
}

console.log('V2 task lifecycle tests passed.');
