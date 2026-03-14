const MIN_INTERVAL_MS = 30_000;
const PERIODIC_INTERVAL_MS = 300_000;
const MAX_PER_SESSION = 40;

export function createObservationTrigger(config = {}) {
	const minInterval = config.minIntervalMs || MIN_INTERVAL_MS;
	const periodicInterval = config.periodicMs || PERIODIC_INTERVAL_MS;
	const maxPerSession = config.maxPerSession || MAX_PER_SESSION;

	let lastObservationAt = 0;
	let lastObservedApp = '';
	let lastPeriodicAt = Date.now();
	let observationCount = 0;

	return {
		/**
		 * Check if an observation should be triggered.
		 * @param {string} currentApp - name of the frontmost application
		 * @returns {string|null} trigger type or null
		 */
		check(currentApp) {
			const now = Date.now();
			if (observationCount >= maxPerSession) return null;
			if (now - lastObservationAt < minInterval) return null;

			// App switch detection
			if (currentApp && currentApp !== lastObservedApp && lastObservedApp) {
				lastObservedApp = currentApp;
				lastObservationAt = now;
				lastPeriodicAt = now;
				observationCount++;
				return 'app_switch';
			}
			if (currentApp) lastObservedApp = currentApp;

			// Periodic baseline
			if (now - lastPeriodicAt >= periodicInterval) {
				lastObservationAt = now;
				lastPeriodicAt = now;
				observationCount++;
				return 'periodic';
			}

			return null;
		},

		/** Record a manual/user-requested observation for rate limiting. */
		recordManual() {
			lastObservationAt = Date.now();
			observationCount++;
		},

		/** Reset all state (e.g. on session restart). */
		reset() {
			lastObservationAt = 0;
			lastObservedApp = '';
			lastPeriodicAt = Date.now();
			observationCount = 0;
		},

		/** Current count of observations this session. */
		get count() {
			return observationCount;
		},
	};
}
