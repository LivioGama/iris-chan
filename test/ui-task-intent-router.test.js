const assert = require('node:assert');

const { routeGoal } = require('../src/main/automation/intent-router');
const { createExecutionPlan } = require('../src/main/automation/planner');

console.log('Running UI task intent router tests...');

const safariPlan = routeGoal('Open Safari and open YouTube.com in Safari');
assert.strictEqual(safariPlan.appHint, 'Safari', 'router should preserve the explicit Safari app hint');
assert.deepStrictEqual(
	safariPlan.steps.map((step) => step.type),
	['openApp', 'openUrl'],
	'router should compile app launch and URL open into semantic steps'
);
assert.strictEqual(
	safariPlan.steps[1].url.toLowerCase(),
	'https://youtube.com',
	'router should normalize bare domains into https URLs'
);

const multiStepPlan = routeGoal('Open YouTube.com, go to Subscriptions tab, click Theo', 'Safari');
assert.deepStrictEqual(
	multiStepPlan.steps.map((step) => step.type),
	['openUrl', 'clickElement', 'clickElement'],
	'router should keep multi-step browser flows semantic'
);
assert.strictEqual(
	multiStepPlan.steps[1].selector.text,
	'Subscriptions',
	'router should keep the target text for navigation clicks'
);
assert.strictEqual(
	multiStepPlan.steps[2].selector.text,
	'Theo',
	'router should preserve the final click target'
);

const contextualSearchPlan = routeGoal('search for Theo');
assert.deepStrictEqual(
	contextualSearchPlan.steps.map((step) => step.type),
	['searchInCurrentContext'],
	'router should preserve in-app search as a semantic contextual search step'
);
assert.strictEqual(
	contextualSearchPlan.steps[0].query,
	'Theo',
	'router should preserve the search query'
);

const browserBackPlan = routeGoal('go back in browser history', 'Safari');
assert.deepStrictEqual(
	browserBackPlan.steps.map((step) => step.type),
	['navigateHistory'],
	'router should recognize browser history navigation as a dedicated semantic step'
);
assert.strictEqual(
	browserBackPlan.steps[0].direction,
	'back',
	'router should preserve the browser history direction'
);

const clickChannelPlan = routeGoal('Search for "Theo GG" on YouTube and click the first channel from the search result.');
assert.deepStrictEqual(
	clickChannelPlan.steps.map((step) => step.type),
	['searchInCurrentContext', 'clickSearchResult'],
	'router should recognize first-channel-result clicks as a dedicated semantic step'
);
assert.strictEqual(
	clickChannelPlan.steps[1].resultKind,
	'channel',
	'router should mark the first-result click as a channel action'
);

const executionPlan = createExecutionPlan({
	goal: 'Open Safari and open YouTube.com in Safari',
	successSignal: 'youtube.com',
});
assert.strictEqual(executionPlan.ok, true, 'planner should return a deterministic execution plan');
assert.strictEqual(
	executionPlan.plan.steps[0].checkpoint.kind,
	'app-switch',
	'openApp should create an app-switch checkpoint'
);
assert.strictEqual(
	executionPlan.plan.steps[1].checkpoint.kind,
	'final',
	'final navigation step should carry final checkpoint verification'
);

const searchPlan = createExecutionPlan({
	goal: 'search for Theo',
});
assert.strictEqual(searchPlan.ok, true, 'planner should build a search execution plan');
assert.strictEqual(
	searchPlan.plan.successSignal,
	'Theo',
	'planner should infer the search query as the success signal for final verification'
);

const historyPlan = createExecutionPlan({
	goal: 'go back in browser history',
	appHint: 'Safari',
});
assert.strictEqual(historyPlan.ok, true, 'planner should build a deterministic browser history plan');
assert.strictEqual(
	historyPlan.plan.steps[0].type,
	'navigateHistory',
	'planner should preserve browser history navigation as its own step type'
);
assert.strictEqual(
	historyPlan.plan.steps[0].direction,
	'back',
	'planner should preserve the history direction for execution'
);

console.log('UI task intent router tests passed.');
