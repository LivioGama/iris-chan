const { URL } = require('node:url');
const { makeTaskError, throwIfAborted, stepLabel } = require('./ui-task-service-utils');

class VerificationEngine {
	constructor(uiTaskService) {
		this.uiTaskService = uiTaskService;
	}

	async verifyCheckpoint(plan, step, outcome, signal) {
		throwIfAborted(signal);
		if (step.checkpoint?.kind === 'app-switch' && step.appName) {
			const frontmost = await this.uiTaskService.worldState.getFrontmostApp({ force: true });
			const expectedName = outcome?.resolvedAppName || step.appName;
			if (!frontmost.ok || frontmost.name !== expectedName) {
				throw makeTaskError(`Expected ${expectedName} to be frontmost`, 'checkpoint_failed');
			}
			return;
		}

		if (step.checkpoint?.kind === 'navigation' && step.url) {
			const frontmost = await this.uiTaskService.worldState.getFrontmostApp({ force: true });
			const appName = frontmost.ok ? frontmost.name : step.appHint;
			if (this.uiTaskService.browserAdapter.isSupported(appName)) {
				const host = (() => {
					try {
						return new URL(step.url).host;
					} catch {
						return step.url;
					}
				})();
				const verify = this.uiTaskService.browserAdapter.verifySignal({ appName, signal: host });
				if (!verify.ok) {
					throw makeTaskError(verify.error || `Navigation checkpoint failed for ${step.url}`, 'checkpoint_failed');
				}
				return;
			}
		}

		if (step.checkpoint?.kind === 'search' && step.query) {
			if (plan.successSignal) {
				await this.verifySuccessSignal(plan, signal);
			}
			return;
		}

		if (step.type === 'editorCommand') {
			const frontmost = await this.uiTaskService.worldState.getFrontmostApp({ force: true });
			const expectedApp = step.appHint || plan.appHint || '';
			if (expectedApp && (!frontmost.ok || frontmost.name !== expectedApp)) {
				throw makeTaskError(`Expected ${expectedApp} to remain frontmost for editor command`, 'checkpoint_failed');
			}
		}

		if (step.checkpoint?.kind === 'final' && plan.successSignal) {
			await this.verifySuccessSignal(plan, signal);
		}

		if (!outcome?.ok) {
			throw makeTaskError(`Checkpoint failed after ${stepLabel(step)}`, 'checkpoint_failed');
		}
	}

	async verifySuccessSignal(plan, signal) {
		throwIfAborted(signal);
		const frontmost = await this.uiTaskService.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : plan.appHint;
		if (this.uiTaskService.browserAdapter.isSupported(appName)) {
			const verify = this.uiTaskService.browserAdapter.verifySignal({ appName, signal: plan.successSignal });
			if (!verify.ok) throw makeTaskError(verify.error, verify.code || 'verify_failed');
			return;
		}
		const axMatch = await this.uiTaskService.worldState.findAccessibilityMatches(plan.successSignal, { limit: 4 });
		if (!axMatch.ok || axMatch.count < 1) {
			throw makeTaskError(`Verification signal "${plan.successSignal}" was not found`, 'verify_failed');
		}
	}
}

module.exports = {
	VerificationEngine,
};
