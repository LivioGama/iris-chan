function isBrowserApp(appName = '') {
	return ['Safari', 'Google Chrome', 'Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Edge', 'Comet'].includes(String(appName || ''));
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
	if ((step.type === 'clickElement' || step.type === 'selectItemByText') && isBrowserApp(step.appHint || step.appName)) return true;
	return false;
}

module.exports = {
	isNativeEligiblePlan,
	isNativeEligibleStep,
};
