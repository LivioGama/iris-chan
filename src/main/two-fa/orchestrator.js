// 2FA Orchestrator: poll loop that detects fields, gathers codes, gates, fills, and emits events
const { detect2FAField } = require('./detector');
const { gatherCodes } = require('./sources');
const { computeConfidence } = require('./confidence');
const { fillCode, verifyFill } = require('./fill');
const log = require('../logger');

class TwoFAOrchestrator {
	constructor({ eventBus, behaviorEngine, settings = {} }) {
		this._eventBus = eventBus;
		this._behaviorEngine = behaviorEngine;
		this._pollIntervalMs = settings.pollIntervalMs || 3000;
		this._confidenceThreshold = settings.confidenceThreshold || 0.85;
		this._fillCooldownMs = settings.fillCooldownMs || 60000;
		this._maxCodeAgeSeconds = settings.maxCodeAgeSeconds || 300;
		this._enabledSources = settings.sources || {};
		this._timer = null;
		this._filling = false;
		this._recentFills = new Map(); // fingerprint → timestamp
		this._enabled = settings.enabled !== false;
	}

	start() {
		if (!this._enabled) {
			log.info('2FA', 'Proactive 2FA disabled in settings');
			return;
		}
		log.info('2FA', `Starting proactive detector (poll: ${this._pollIntervalMs}ms, threshold: ${this._confidenceThreshold})`);
		this._timer = setInterval(() => this._tick(), this._pollIntervalMs);
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	updateSettings(settings = {}) {
		const wasEnabled = this._enabled;
		const oldInterval = this._pollIntervalMs;

		if ('pollIntervalMs' in settings) this._pollIntervalMs = settings.pollIntervalMs;
		if ('confidenceThreshold' in settings) this._confidenceThreshold = settings.confidenceThreshold;
		if ('fillCooldownMs' in settings) this._fillCooldownMs = settings.fillCooldownMs;
		if ('maxCodeAgeSeconds' in settings) this._maxCodeAgeSeconds = settings.maxCodeAgeSeconds;
		if ('sources' in settings) this._enabledSources = settings.sources;
		if ('enabled' in settings) this._enabled = settings.enabled !== false;

		if (!this._enabled && wasEnabled) {
			this.stop();
		} else if (this._enabled && !wasEnabled) {
			this.start();
		} else if (this._enabled && this._timer && this._pollIntervalMs !== oldInterval) {
			this.stop();
			this.start();
		}
	}

	getStatus() {
		return {
			enabled: this._enabled,
			running: !!this._timer,
			filling: this._filling,
			recentFillCount: this._recentFills.size,
			pollIntervalMs: this._pollIntervalMs,
			confidenceThreshold: this._confidenceThreshold,
		};
	}

	async _tick() {
		if (this._filling) return;
		this._filling = true;

		try {
			// Respect behavior mode
			const mode = this._behaviorEngine?.getMode?.() || this._behaviorEngine?.mode;
			if (mode === 'silent') return;

			// Prune expired fingerprints
			const now = Date.now();
			for (const [fp, ts] of this._recentFills) {
				if (now - ts > this._fillCooldownMs) this._recentFills.delete(fp);
			}

			// 1. Detect 2FA field
			const fieldInfo = await detect2FAField();
			if (!fieldInfo.detected) return;

			// 2. Check dedup
			const fingerprint = `${fieldInfo.appName}:${fieldInfo.windowTitle}:${fieldInfo.fieldContext?.slice(0, 100)}`;
			if (this._recentFills.has(fingerprint)) return;

			// 3. Skip if already filled
			if (fieldInfo.focusedValue && fieldInfo.focusedValue.length >= 4) return;

			this._emit('TWO_FA_FIELD_DETECTED', {
				appName: fieldInfo.appName,
				windowTitle: fieldInfo.windowTitle,
				type: fieldInfo.type,
				confidence: fieldInfo.confidence,
			});

			// 4. Gather codes from all sources
			const context = {
				appName: fieldInfo.appName,
				windowTitle: fieldInfo.windowTitle,
				maxCodeAgeSeconds: this._maxCodeAgeSeconds,
			};
			const codes = await gatherCodes(context, this._enabledSources);
			if (!codes.length) {
				this._emit('TWO_FA_NO_CODE', { appName: fieldInfo.appName });
				return;
			}

			// 5. Pick best and gate on confidence
			const best = codes[0];
			const overallConfidence = computeConfidence(fieldInfo, best);
			if (overallConfidence < this._confidenceThreshold) {
				this._emit('TWO_FA_LOW_CONFIDENCE', {
					confidence: overallConfidence,
					source: best.source,
					threshold: this._confidenceThreshold,
				});
				return;
			}

			// 6. Fill
			const maskedCode = best.code.slice(0, 2) + '*'.repeat(best.code.length - 2);
			log.info('2FA', `Auto-filling ${best.code.length}-digit code (${maskedCode}) from ${best.source} into ${fieldInfo.appName}`);
			this._emit('TWO_FA_FILL_START', {
				source: best.source,
				codeLength: best.code.length,
				app: fieldInfo.appName,
				confidence: overallConfidence,
			});

			const fillResult = await fillCode(best.code, fieldInfo);
			if (fillResult.ok) {
				this._recentFills.set(fingerprint, Date.now());
				const verification = await verifyFill();
				this._emit('TWO_FA_FILL_SUCCESS', {
					source: best.source,
					method: fillResult.method,
					verified: verification.verified,
				});
				log.info('2FA', `Fill success via ${fillResult.method}, verified: ${verification.verified}`);
			} else {
				this._emit('TWO_FA_FILL_FAILED', {
					source: best.source,
					error: fillResult.error,
				});
				log.warn('2FA', `Fill failed: ${fillResult.error}`);
			}
		} catch (err) {
			log.error('2FA', 'Orchestrator tick error:', err.message);
		} finally {
			this._filling = false;
		}
	}

	_emit(type, payload) {
		try {
			this._eventBus?.emitEvent?.(type, payload, 'two-fa');
		} catch { /* event bus may not be ready */ }
	}
}

module.exports = { TwoFAOrchestrator };
