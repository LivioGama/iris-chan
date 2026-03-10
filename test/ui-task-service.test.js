const assert = require('node:assert');

require('ts-node').register({ transpileOnly: true });

const { UITaskService, createTaskSignature, createPlanSignature } = require('../src/main/automation/ui-task-service');

console.log('Running UI task service tests...');

assert.strictEqual(
	createTaskSignature({ goal: ' Open youtube.com ', appHint: 'Safari', successSignal: 'YouTube' }),
	createTaskSignature({ goal: 'open   youtube.com', appHint: 'safari', successSignal: 'youtube' }),
	'task signatures should normalize case and whitespace'
);

assert.strictEqual(
	createPlanSignature({
		appHint: 'Safari',
		steps: [{ type: 'openUrl', url: 'https://youtube.com', appHint: 'Safari' }],
	}),
	createPlanSignature({
		appHint: 'safari',
		steps: [{ type: 'openUrl', url: 'https://youtube.com', appHint: 'safari' }],
	}),
	'plan signatures should normalize equivalent execution plans'
);

assert.notStrictEqual(
	createPlanSignature({
		appHint: 'Safari',
		steps: [{ type: 'navigateHistory', direction: 'back', appHint: 'Safari' }],
	}),
	createPlanSignature({
		appHint: 'Safari',
		steps: [{ type: 'navigateHistory', direction: 'forward', appHint: 'Safari' }],
	}),
	'plan signatures should preserve browser history direction'
);

async function testRecentDuplicateDedupes() {
	const service = new UITaskService();
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	let executeCount = 0;
	service._executePlan = async () => {
		executeCount += 1;
		return 'Opened https://youtube.com in Safari';
	};

	const first = await service.runTask({ goal: 'Open youtube.com', app_hint: 'Safari', success_signal: 'YouTube' });
	const second = await service.runTask({ goal: 'open   youtube.com', app_hint: 'safari', success_signal: 'youtube.com' });

	assert.strictEqual(first.ok, true, 'first run should succeed');
	assert.strictEqual(second.ok, true, 'duplicate run should also resolve successfully');
	assert.strictEqual(executeCount, 1, 'duplicate run should not execute the plan again');
}

async function testInFlightDuplicateDedupes() {
	const service = new UITaskService();
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	let resolvePlan;
	service._executePlan = () => new Promise((resolve) => {
		resolvePlan = resolve;
	});

	const firstPromise = service.runTask({ goal: 'Search for Theo', app_hint: 'Safari' });
	const second = await service.runTask({ goal: 'search for Theo', app_hint: 'safari' });
	assert.strictEqual(second.ok, true, 'in-flight duplicate should resolve as a no-op');
	assert.match(second.result, /already running/i, 'in-flight duplicate should report the existing task');

	resolvePlan('Searched for "Theo" in Safari');
	const first = await firstPromise;
	assert.strictEqual(first.ok, true, 'original task should still complete');
}

Promise.resolve()
	.then(testRecentDuplicateDedupes)
	.then(testInFlightDuplicateDedupes)
	.then(() => {
		console.log('UI task service tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
