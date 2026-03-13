const { routeGoal } = require('./intent-router');

function createCheckpoint(step, index, total) {
	if (index === total - 1) return { kind: 'final', reason: 'task-complete' };
	if (step.type === 'openApp') return { kind: 'app-switch', reason: 'app-opened' };
	if (step.type === 'openUrl') return { kind: 'navigation', reason: 'url-opened' };
	if (step.type === 'searchInCurrentContext') return { kind: 'search', reason: 'query-submitted' };
	if (step.type === 'clickSearchResult') return { kind: 'final', reason: 'result-opened' };
	if (step.type === 'mediaControl') return { kind: 'final', reason: 'media-control' };
	if (step.type === 'editorCommand') return { kind: 'final', reason: 'editor-command' };
	if (step.type === 'resolveSystemDefault') return { kind: 'final', reason: 'system-query' };
	if (step.type === 'cleanupInstallArtifact') return { kind: 'final', reason: 'install-cleanup' };
	return null;
}

function toExecutionStep(step, index, total) {
	return {
		id: `step_${index + 1}`,
		type: step.type,
		appHint: step.appHint || '',
		appName: step.appName || '',
		url: step.url || '',
		value: step.value || '',
		direction: step.direction || 'down',
		query: step.query || '',
		resultKind: step.resultKind || '',
		action: step.action || '',
		kind: step.kind || '',
		key: step.key || '',
		target: step.target || '',
		position: step.position || 0,
		selector: step.selector || null,
		checkpoint: createCheckpoint(step, index, total),
	};
}

function createExecutionPlan({ goal, appHint = '', successSignal = '' }) {
	const intent = routeGoal(goal, appHint);
	if (!intent.steps.length) {
		return {
			ok: false,
			error: `Could not build a deterministic UI plan for "${goal}"`,
			intent,
		};
	}

	const lastStep = intent.steps[intent.steps.length - 1];
	const inferredSuccessSignal = String(successSignal || '').trim() || (lastStep?.type === 'searchInCurrentContext' ? String(lastStep.query || '').trim() : '');

	return {
		ok: true,
		plan: {
			goal: intent.goal,
			appHint: intent.appHint || appHint || '',
			successSignal: inferredSuccessSignal,
			intent: {
				goal: intent.goal,
				appHint: intent.appHint || appHint || '',
				confidence: intent.confidence,
			},
			steps: intent.steps.map((step, index) => toExecutionStep(step, index, intent.steps.length)),
		},
	};
}

module.exports = {
	createExecutionPlan,
};
