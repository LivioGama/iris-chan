function isBrowserApp(appName = '') {
	return ['Safari', 'Google Chrome', 'Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Edge', 'Comet'].includes(String(appName || ''));
}

const RESOLVER_IDS = {
	SYSTEM_DEFAULT_APP: 'system.default_app',
	SYSTEM_QUERY: 'system.query',
	APP_ACTIVATE: 'app.activate',
	BROWSER_OPEN_URL: 'browser.open_url',
	BROWSER_SEARCH: 'browser.search',
	BROWSER_HISTORY: 'browser.history_navigation',
	BROWSER_RESULT: 'browser.result_selection',
	BROWSER_MEDIA: 'browser.media_control',
	FINDER_SELECTION: 'finder.selection',
	FINDER_OPEN: 'finder.open',
	EDITOR_ACTIVATE: 'editor.activate',
	EDITOR_COMMAND: 'editor.command',
};

function isEditorApp(appName = '') {
	return ['Visual Studio Code', 'Code', 'Cursor', 'Zed', 'Sublime Text', 'TextEdit', 'Text Edit', 'Nova'].includes(String(appName || ''));
}

function isNativeEligiblePlan(plan = {}) {
	const steps = Array.isArray(plan.steps) ? plan.steps : [];
	return steps.some((step) => isNativeEligibleStep(step));
}

function isNativeEligibleStep(step = {}) {
	if (!step || !step.type) return false;
	if (step.type === 'openApp') return true;
	if (step.type === 'openUrl') return true;
	if (step.type === 'navigateHistory') return true;
	if (step.type === 'searchInCurrentContext') return true;
	if (step.type === 'clickSearchResult') return true;
	if (step.type === 'mediaControl') return true;
	if (step.type === 'editorCommand') return true;
	if ((step.type === 'clickElement' || step.type === 'selectItemByText') && isBrowserApp(step.appHint || step.appName)) return true;
	if ((step.type === 'clickElement' || step.type === 'selectItemByText') && String(step.appHint || step.appName || '').trim() === 'Finder') return true;
	return false;
}

function resolverIdForStep(step = {}, appName = '') {
	if (!step || !step.type) return '';
	if (step.type === 'openApp') {
		if (/default (browser|mail)/i.test(step.appName || '')) return RESOLVER_IDS.SYSTEM_DEFAULT_APP;
		if (isEditorApp(step.appName || step.appHint || appName)) return RESOLVER_IDS.EDITOR_ACTIVATE;
		return RESOLVER_IDS.APP_ACTIVATE;
	}
	if (step.type === 'resolveSystemDefault') return RESOLVER_IDS.SYSTEM_QUERY;
	if (step.type === 'openUrl') return RESOLVER_IDS.BROWSER_OPEN_URL;
	if (step.type === 'searchInCurrentContext') return RESOLVER_IDS.BROWSER_SEARCH;
	if (step.type === 'navigateHistory') return RESOLVER_IDS.BROWSER_HISTORY;
	if (step.type === 'clickSearchResult') return RESOLVER_IDS.BROWSER_RESULT;
	if (step.type === 'mediaControl') return RESOLVER_IDS.BROWSER_MEDIA;
	if (step.type === 'editorCommand') return RESOLVER_IDS.EDITOR_COMMAND;
	if (step.type === 'clickElement' && String(appName || step.appHint || step.appName || '').trim() === 'Finder') return RESOLVER_IDS.FINDER_OPEN;
	if (step.type === 'selectItemByText' && String(appName || step.appHint || step.appName || '').trim() === 'Finder') return RESOLVER_IDS.FINDER_SELECTION;
	if ((step.type === 'clickElement' || step.type === 'selectItemByText') && isBrowserApp(appName || step.appHint || step.appName || '')) {
		return RESOLVER_IDS.BROWSER_RESULT;
	}
	return '';
}

function getResolverCatalog() {
	return [
		{ id: RESOLVER_IDS.SYSTEM_DEFAULT_APP, domain: 'system', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.SYSTEM_QUERY, domain: 'system', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.APP_ACTIVATE, domain: 'general', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.BROWSER_OPEN_URL, domain: 'browser', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.BROWSER_SEARCH, domain: 'browser', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.BROWSER_HISTORY, domain: 'browser', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.BROWSER_RESULT, domain: 'browser', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.BROWSER_MEDIA, domain: 'media', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.FINDER_SELECTION, domain: 'finder', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.FINDER_OPEN, domain: 'finder', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.EDITOR_ACTIVATE, domain: 'editor', learnability: 'stable', stabilizationCandidate: true },
		{ id: RESOLVER_IDS.EDITOR_COMMAND, domain: 'editor', learnability: 'stable', stabilizationCandidate: true },
	];
}

module.exports = {
	isNativeEligiblePlan,
	isNativeEligibleStep,
	resolverIdForStep,
	RESOLVER_IDS,
	getResolverCatalog,
	isEditorApp,
};
