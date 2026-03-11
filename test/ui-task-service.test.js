const assert = require('node:assert');

require('ts-node').register({ transpileOnly: true });

const { UITaskService, createTaskSignature, createPlanSignature } = require('../src/main/automation/ui-task-service');
const { NativeFallbackManager } = require('../src/main/automation/native-fallback-manager');

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

async function testLearnedSkillRunsBeforeBuiltinPlan() {
	const service = new UITaskService({
		selfImprovementManager: {
			findMatchingSkill() {
				return { id: 'auto-safari-back', name: 'auto-safari-back' };
			},
			buildPlanFromSkill() {
				return {
					goal: 'go back in my browser',
					appHint: 'Safari',
					successSignal: '',
					steps: [{ type: 'navigateHistory', appHint: 'Safari', direction: 'back' }],
				};
			},
			recordLearnedOutcome() {},
			recordSuccessfulPlan() {},
			replaceSkill() {},
		},
	});
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Safari' });
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	const seen = [];
	service._executePlan = async (activeTask) => {
		seen.push(activeTask.planSource);
		return activeTask.planSource === 'learned-skill' ? 'Went back via learned skill' : 'Went back via builtin';
	};

	const result = await service.runTask({ goal: 'go back in my browser', app_hint: 'Safari' });

	assert.strictEqual(result.ok, true, 'learned skill route should succeed');
	assert.deepStrictEqual(seen, ['learned-skill'], 'learned skill should run before builtin planning');
}

async function testBuiltinFallbackReplacesFailingLearnedSkill() {
	let recordCalls = [];
	let replaceCalls = [];
	const service = new UITaskService({
		selfImprovementManager: {
			findMatchingSkill() {
				return { id: 'auto-search', name: 'auto-search', description: 'Search workflow' };
			},
			buildPlanFromSkill() {
				return {
					goal: 'search for Theo',
					appHint: 'Safari',
					successSignal: 'Theo',
					steps: [{ type: 'searchInCurrentContext', appHint: 'Safari', query: 'Theo' }],
				};
			},
			recordLearnedOutcome(entry, success) {
				recordCalls.push({ id: entry.id, success });
			},
			recordSuccessfulPlan(details) {
				recordCalls.push({ builtinRecovered: details.recoveredFromSkillFailure === true });
			},
			replaceSkill(entry, details) {
				replaceCalls.push({ id: entry.id, details });
			},
		},
	});
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Safari' });
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	service._executePlan = async (activeTask) => {
		if (activeTask.planSource === 'learned-skill') {
			throw new Error('learned skill failed');
		}
		return 'Recovered via builtin workflow';
	};

	const result = await service.runTask({ goal: 'search for Theo', app_hint: 'Safari' });

	assert.strictEqual(result.ok, true, 'builtin fallback should still succeed');
	assert.deepStrictEqual(recordCalls[0], { id: 'auto-search', success: false }, 'failed learned skill should be recorded');
	assert.deepStrictEqual(recordCalls[1], { builtinRecovered: true }, 'builtin recovery should be recorded for promotion logic');
	assert.strictEqual(replaceCalls.length, 1, 'successful builtin recovery should trigger replacement of the failing learned skill');
}

async function testNativeEligibleFailureAuthorizesPointerFallback() {
	const fallbackManager = new NativeFallbackManager();
	const service = new UITaskService({ nativeFallbackManager: fallbackManager });
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	service._executePlan = async () => {
		const err = new Error('Need screenshot rescue');
		err.code = 'ax_press_failed';
		err.pointerFallbackEligible = true;
		err.pointerFallbackReason = 'native and accessibility exhausted';
		throw err;
	};

	const result = await service.runTask({ goal: 'Open my default browser and go to youtube.com', app_hint: 'Safari' });

	assert.strictEqual(result.ok, false, 'task should still fail after native/AX exhaustion');
	assert.strictEqual(fallbackManager.canUsePointerTools().ok, true, 'pointer fallback should become temporarily authorized');
}

async function testFalsePositiveLearnedSkillIsDemotedAndBypassed() {
	let falsePositiveCalls = [];
	const service = new UITaskService({
		selfImprovementManager: {
			findMatchingSkill() {
				return { id: 'auto-arc', name: 'auto-arc', description: 'Open YouTube in Arc' };
			},
			buildPlanFromSkill() {
				return {
					goal: 'Open youtube.com in Arc',
					appHint: 'Arc',
					successSignal: 'youtube',
					steps: [{ type: 'openUrl', appHint: 'Arc', url: 'https://youtube.com' }],
				};
			},
			recordLearnedOutcome(entry, success, details) {
				if (details?.successType === 'false_positive') {
					falsePositiveCalls.push({ id: entry.id, reason: details.reason });
				}
			},
			recordSuccessfulPlan() {},
			replaceSkill() {},
		},
	});
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Arc' });
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};
	const seen = [];
	service._executePlan = async (activeTask) => {
		seen.push(activeTask.planSource);
		return activeTask.planSource === 'learned-skill'
			? 'Opened https://youtube.com in Arc'
			: 'Searched for Theo in Arc';
	};

	const result = await service.runTask({ goal: 'Search for Theo', app_hint: 'Arc' });

	assert.strictEqual(result.ok, true, 'builtin fallback should still complete');
	assert.deepStrictEqual(seen, ['learned-skill', 'builtin'], 'false-positive learned skill should be bypassed and builtin planner should run');
	assert.strictEqual(falsePositiveCalls.length, 1, 'false-positive learned skill should be demoted');
}

async function testMediaControlStepExecutesViaResolver() {
	const service = new UITaskService();
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Arc' });
	service.browserAdapter.controlMedia = ({ appName, action }) => ({
		ok: true,
		result: `Paused media in ${appName}`,
		action,
	});

	const result = await service._executeMediaControl({ type: 'mediaControl', action: 'pause', appHint: 'Arc' }, null);

	assert.strictEqual(result.ok, true, 'media control should succeed');
	assert.strictEqual(result.tier, 'native', 'media control should use native/app-specific tier first');
	assert.strictEqual(result.resolverId, 'browser.media_control', 'media control should annotate resolver id');
	assert.strictEqual(result.domain, 'media', 'media control should annotate media domain');
}

async function testFinderSelectionUsesNativeResolver() {
	const service = new UITaskService();
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Finder' });
	service.inputMonitor.start = async () => {};
	service.inputMonitor.stop = () => {};

	const filesModule = require('../src/main/tools/files');
	const originalSelect = filesModule.finder_select_item;
	filesModule.finder_select_item = async ({ name }) => ({ ok: true, result: `Selected Finder item "${name}"`, path: `/tmp/${name}` });

	try {
		const result = await service._executeClickByText({
			type: 'selectItemByText',
			appHint: 'Finder',
			selector: { text: 'Documents', exact: false },
		}, null);
		assert.strictEqual(result.ok, true, 'finder selection should succeed');
		assert.strictEqual(result.tier, 'native', 'finder selection should use native tier');
		assert.strictEqual(result.domain, 'finder', 'finder selection should annotate finder domain');
		assert.strictEqual(result.resolverId, 'finder.selection', 'finder selection should annotate finder resolver id');
	} finally {
		filesModule.finder_select_item = originalSelect;
	}
}

async function testEditorCommandUsesEditorResolver() {
	const service = new UITaskService();
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Visual Studio Code' });
	const result = await service._executeEditorCommand({
		type: 'editorCommand',
		action: 'save',
		key: 'cmd+s',
		appHint: 'Visual Studio Code',
	}, null);
	assert.strictEqual(result.ok, true, 'editor command should succeed');
	assert.strictEqual(result.domain, 'editor', 'editor command should annotate editor domain');
	assert.strictEqual(result.resolverId, 'editor.command', 'editor command should annotate editor command resolver id');
}

async function testOpenUrlAnnotatesResolverMetadata() {
	const service = new UITaskService();
	service.worldState.getFrontmostApp = async () => ({ ok: true, name: 'Arc' });
	service.browserAdapter.openUrl = ({ appName, url }) => ({
		ok: true,
		result: `Opened ${url} in ${appName}`,
		url,
	});

	const result = await service._executeOpenUrl({ type: 'openUrl', appHint: 'Arc', url: 'https://youtube.com' }, null);

	assert.strictEqual(result.ok, true, 'openUrl should succeed');
	assert.strictEqual(result.tier, 'native', 'openUrl should annotate native tier');
	assert.strictEqual(result.domain, 'browser', 'openUrl should annotate browser domain');
	assert.strictEqual(result.resolverId, 'browser.open_url', 'openUrl should annotate browser resolver id');
}

Promise.resolve()
	.then(testRecentDuplicateDedupes)
	.then(testInFlightDuplicateDedupes)
	.then(testLearnedSkillRunsBeforeBuiltinPlan)
	.then(testBuiltinFallbackReplacesFailingLearnedSkill)
	.then(testNativeEligibleFailureAuthorizesPointerFallback)
	.then(testFalsePositiveLearnedSkillIsDemotedAndBypassed)
	.then(testMediaControlStepExecutesViaResolver)
	.then(testFinderSelectionUsesNativeResolver)
	.then(testEditorCommandUsesEditorResolver)
	.then(testOpenUrlAnnotatesResolverMetadata)
	.then(() => {
		console.log('UI task service tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
