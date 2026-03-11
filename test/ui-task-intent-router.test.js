const assert = require('node:assert');

const { normalizeSearchQuery, routeGoal } = require('../src/main/automation/intent-router');
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

assert.strictEqual(
	normalizeSearchQuery('YouTube for TheoGG'),
	'TheoGG',
	'search normalization should drop YouTube context prefixes from the actual query'
);

assert.strictEqual(
	normalizeSearchQuery('YouTube channel Theo.gg'),
	'Theo.gg',
	'search normalization should keep the channel name and drop YouTube/channel boilerplate'
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

const mediaPausePlan = routeGoal('Pause the currently playing video', 'Arc');
assert.deepStrictEqual(
	mediaPausePlan.steps.map((step) => step.type),
	['mediaControl'],
	'router should recognize browser media-control intents semantically'
);
assert.strictEqual(
	mediaPausePlan.steps[0].action,
	'pause',
	'router should preserve the media control action'
);

const editorOpenPlan = routeGoal('Open Visual Studio Code');
assert.deepStrictEqual(
	editorOpenPlan.steps.map((step) => step.type),
	['openApp'],
	'router should recognize editor app launches as semantic openApp steps'
);
assert.strictEqual(
	editorOpenPlan.steps[0].appName,
	'Visual Studio Code',
	'router should preserve the editor app target'
);

const editorCommandPlan = routeGoal('Save', 'Visual Studio Code');
assert.deepStrictEqual(
	editorCommandPlan.steps.map((step) => step.type),
	['editorCommand'],
	'router should recognize editor commands semantically'
);
assert.strictEqual(
	editorCommandPlan.steps[0].key,
	'cmd+s',
	'router should map save to the native editor shortcut'
);

const editorPastePlan = routeGoal('Paste', 'Visual Studio Code');
assert.deepStrictEqual(
	editorPastePlan.steps.map((step) => step.type),
	['editorCommand'],
	'router should recognize additional editor commands semantically'
);
assert.strictEqual(
	editorPastePlan.steps[0].key,
	'cmd+v',
	'router should map paste to the native editor shortcut'
);

const settingsOpenPlan = routeGoal('Open system settings');
assert.deepStrictEqual(
	settingsOpenPlan.steps.map((step) => step.type),
	['openApp'],
	'router should recognize system settings launches as semantic openApp steps'
);
assert.strictEqual(
	settingsOpenPlan.steps[0].appName,
	'System Settings',
	'router should preserve the System Settings app target'
);

const utilityOpenPlan = routeGoal('Open Activity Monitor');
assert.deepStrictEqual(
	utilityOpenPlan.steps.map((step) => step.type),
	['openApp'],
	'router should recognize utility app launches as semantic openApp steps'
);
assert.strictEqual(
	utilityOpenPlan.steps[0].appName,
	'Activity Monitor',
	'router should preserve the utility app target'
);

const systemQueryPlan = routeGoal('What is my default browser');
assert.deepStrictEqual(
	systemQueryPlan.steps.map((step) => step.type),
	['resolveSystemDefault'],
	'router should recognize default-app queries as semantic system queries'
);
assert.strictEqual(
	systemQueryPlan.steps[0].kind,
	'browser',
	'router should preserve the queried default-app kind'
);

const defaultBrowserPlan = routeGoal('open my default browser');
assert.deepStrictEqual(
	defaultBrowserPlan.steps.map((step) => step.type),
	['openApp'],
	'router should treat default browser requests as app-open steps'
);
assert.strictEqual(
	defaultBrowserPlan.steps[0].appName,
	'default browser',
	'router should preserve the default browser target for native resolution'
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

const youtubeSearchPlan = routeGoal('search YouTube for TheoGG');
assert.deepStrictEqual(
	youtubeSearchPlan.steps.map((step) => step.type),
	['searchInCurrentContext'],
	'router should keep YouTube searches semantic instead of embedding page-context words in the query'
);
assert.strictEqual(
	youtubeSearchPlan.steps[0].query,
	'TheoGG',
	'router should extract the actual YouTube search query'
);

const youtubeChannelSearchPlan = routeGoal('find YouTube channel Theo.gg');
assert.strictEqual(
	youtubeChannelSearchPlan.steps[0].query,
	'Theo.gg',
	'router should extract the channel name from YouTube channel search phrasing'
);

const videosTabPlan = routeGoal('go to the Videos tab on the current YouTube channel');
assert.deepStrictEqual(
	videosTabPlan.steps.map((step) => step.type),
	['clickElement'],
	'router should keep channel-tab navigation semantic'
);
assert.strictEqual(
	videosTabPlan.steps[0].selector.text,
	'Videos',
	'router should strip current-page context from tab clicks and preserve the actual tab label'
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
