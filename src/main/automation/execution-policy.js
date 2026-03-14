const { makeTaskError } = require('./ui-task-service-utils');

const DESTRUCTIVE_TARGET_PATTERN = /\b(delete|remove|trash|discard|erase|overwrite|replace|eject|detach|empty trash)\b/i;
const EXPLICIT_DESTRUCTIVE_INTENT_PATTERN = /\b(delete|remove|trash|discard|erase|overwrite|replace|eject|detach|clean(?:\s+up)?)\b/i;
const PRIMARY_TARS_STEP_TYPES = new Set([
	'genericTarsGoal',
	'clickElement',
	'selectItemByText',
	'clickSearchResult',
	'setElementValue',
	'searchInCurrentContext',
	'scrollUntilVisible',
	'navigateHistory',
]);

function isDestructiveSelectionStep(step = {}) {
	return ['clickElement', 'selectItemByText', 'clickSearchResult'].includes(step.type)
		&& DESTRUCTIVE_TARGET_PATTERN.test(String(step.selector?.text || step.resultKind || ''));
}

function classifySafetyClass(plan = {}, step = {}) {
	if (step.type === 'cleanupInstallArtifact') {
		return 'install_cleanup';
	}
	if (isDestructiveSelectionStep(step)) {
		return 'destructive';
	}
	switch (step.type) {
		case 'openApp':
		case 'resolveSystemDefault':
		case 'openUrl':
		case 'navigateHistory':
			return 'deterministic';
		case 'setElementValue':
		case 'editorCommand':
		case 'mediaControl':
			return 'guarded';
		case 'clickElement':
		case 'selectItemByText':
		case 'clickSearchResult':
		case 'scrollUntilVisible':
			return 'pointer';
		default:
			return 'standard';
	}
}

function supportsPrimaryTars(step = {}) {
	return PRIMARY_TARS_STEP_TYPES.has(step.type);
}

function buildExecutionContract(plan = {}, step = {}, tarsEnabled = false) {
	const safetyClass = classifySafetyClass(plan, step);
	const fallbackTiers = [];
	const blocksPointerAutomation = safetyClass === 'destructive' || safetyClass === 'install_cleanup';
	if (!blocksPointerAutomation && tarsEnabled && supportsPrimaryTars(step)) {
		fallbackTiers.push('tars');
	} else {
		fallbackTiers.push('semantic');
		if (!blocksPointerAutomation && (step.type === 'clickElement' || step.type === 'selectItemByText' || step.type === 'clickSearchResult' || step.type === 'scrollUntilVisible')) {
			fallbackTiers.push('tars-rescue');
		}
	}
	return {
		safetyClass,
		checkpointKind: step.checkpoint?.kind || (plan.successSignal ? 'success-signal' : 'none'),
		confirmationPolicy: safetyClass === 'install_cleanup'
			? 'explicit-install-cleanup-intent'
			: safetyClass === 'destructive'
				? 'explicit-destructive-intent'
				: 'none',
		verificationPolicy: safetyClass === 'install_cleanup'
			? 'artifact-removed-or-detached'
			: safetyClass === 'destructive'
				? 'blocked-without-dedicated-flow'
				: 'standard',
		primaryTier: fallbackTiers[0] || 'semantic',
		fallbackTiers,
	};
}

class ExecutionPolicy {
	constructor(uiTaskService) {
		this.uiTaskService = uiTaskService;
	}

	buildExecutionContract(plan, step, tarsEnabled) {
		return buildExecutionContract(plan, step, tarsEnabled);
	}

	enforceSafetyContract(plan, step, executionContract) {
		if (executionContract.safetyClass === 'destructive') {
			throw makeTaskError(
				`Blocked destructive UI action for "${step.selector?.text || step.resultKind || step.type}". Use a dedicated verified flow instead of a generic GUI click.`,
				'safety_confirmation_required'
			);
		}
		if (executionContract.safetyClass !== 'install_cleanup') {
			return;
		}
		if (!EXPLICIT_DESTRUCTIVE_INTENT_PATTERN.test(String(plan.goal || ''))) {
			throw makeTaskError(
				'Install cleanup requires explicit user intent before removing or ejecting installer artifacts.',
				'safety_confirmation_required'
			);
		}
	}

	supportsPrimaryTars(step) {
		return supportsPrimaryTars(step);
	}
}

module.exports = {
	ExecutionPolicy,
};
