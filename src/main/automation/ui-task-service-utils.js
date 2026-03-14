function normalizeSignatureText(value = '') {
	return String(value || '')
		.toLowerCase()
		.replace(/["'`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function makeTaskError(message, code = 'ui_task_failed', details = {}) {
	const err = new Error(message);
	err.code = code;
	Object.assign(err, details);
	return err;
}

function throwIfAborted(signal) {
	if (signal?.aborted) {
		throw signal.reason || makeTaskError('UI task interrupted', 'aborted');
	}
}

function stepLabel(step) {
	switch (step.type) {
		case 'openApp':
			return `Open ${step.appName || step.appHint}`;
		case 'openUrl':
			return `Open ${step.url}`;
		case 'clickElement':
			return `Click ${step.selector?.text || 'target'}`;
		case 'selectItemByText':
			return `Select ${step.selector?.text || 'item'}`;
		case 'setElementValue':
			return `Type ${step.value}`;
		case 'searchInCurrentContext':
			return `Search for ${step.query}`;
		case 'clickSearchResult':
			return `Click first ${step.resultKind || ''} result`;
		case 'navigateHistory':
			return step.direction === 'forward' ? 'Go forward' : 'Go back';
		case 'scrollUntilVisible':
			return `Scroll ${step.direction}`;
		default:
			return step.type;
	}
}

module.exports = {
	normalizeSignatureText,
	makeTaskError,
	throwIfAborted,
	stepLabel,
};
