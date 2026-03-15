// 2FA Orchestrator: poll loop that detects fields, gathers codes, gates, fills, and emits events
const { detect2FAField } = require('./detector');
const { gatherCodes } = require('./sources');
const { computeConfidence } = require('./confidence');
const { fillCode, verifyFill } = require('./fill');
const { extractOTP } = require('../tools/auth');
const { NotificationMonitor } = require('./notification-monitor');
const { CodeCache } = require('./code-cache');
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
		this._lastFieldInfo = null; // cached from last detection for instant notification fill
		this._codeCache = new CodeCache({ maxAgeMs: (settings.maxCodeAgeSeconds || 300) * 1000 });
		this._notifMonitor = new NotificationMonitor({
			onNotification: (evt) => this._onNotificationReceived(evt),
		});
	}

	start() {
		if (!this._enabled) {
			log.info('2FA', 'Proactive 2FA disabled in settings');
			return;
		}
		log.info('2FA', `Starting proactive detector (poll: ${this._pollIntervalMs}ms, threshold: ${this._confidenceThreshold})`);
		this._timer = setInterval(() => this._tick(), this._pollIntervalMs);
		this._notifMonitor.start().catch(err => log.warn('2FA', `Notification monitor failed to start: ${err.message}`));
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		this._notifMonitor.stop();
		this._lastFieldInfo = null;
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

	getRecentCodes(limit = 5) {
		return this._codeCache.getLatest(limit);
	}

	getCodeByKeyword(keyword) {
		return this._codeCache.getByKeyword(keyword);
	}

	getFullCode(keywordOrMasked) {
		return this._codeCache.getFullCode(keywordOrMasked);
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
		log.info('2FA', '[Tick] Detector running...');
		if (this._filling) {
			log.debug('2FA', '[Tick] Skipped: already filling');
			return;
		}
		this._filling = true;
		log.info('2FA', '[Tick] Starting detection...');

		try {
			// Respect behavior mode
			const mode = this._behaviorEngine?.getMode?.() || this._behaviorEngine?.mode;
			if (mode === 'silent') {
				log.info('2FA', 'Tick skipped: behavior mode is silent');
				return;
			}
			log.info('2FA', `[Tick] Mode: ${mode}, checking for 2FA field...`);

			// Prune expired fingerprints
			const now = Date.now();
			for (const [fp, ts] of this._recentFills) {
				if (now - ts > this._fillCooldownMs) this._recentFills.delete(fp);
			}

			// 1. Detect 2FA field
			const fieldInfo = await detect2FAField();
			if (!fieldInfo.detected) {
				this._lastFieldInfo = null;
				log.info('2FA', `No 2FA field detected (app: ${fieldInfo.appName || 'unknown'}, window: ${fieldInfo.windowTitle || 'unknown'})`);
				return;
			}

			// 2. Check dedup
			const fingerprint = `${fieldInfo.appName}:${fieldInfo.windowTitle}:${fieldInfo.fieldContext?.slice(0, 100)}`;
			if (this._recentFills.has(fingerprint)) return;

			// 3. Skip if already filled
			if (fieldInfo.focusedValue && fieldInfo.focusedValue.length >= 4) return;

			// Cache field info for instant notification-driven fills
			this._lastFieldInfo = { ...fieldInfo, fingerprint };

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
			// Cache all found codes regardless of confidence threshold
			for (const c of codes) {
				this._codeCache.add({ code: c.code, source: c.source, sender: c.meta?.sender, text: c.meta?.text, timestamp: c.timestamp });
			}

		// Also include recently cached codes (SMS/notifications that arrived earlier but weren't filled)
		const recentCached = this._codeCache.getLatest(5);
		if (recentCached.length > 0) {
			log.info('2FA', `Found ${recentCached.length} recent cached codes for pool`);
			codes.unshift(...recentCached.map(c => ({
				code: c.code,
				source: c.source || 'cache',
				confidence: 0.9,
				timestamp: c.timestamp,
				meta: { sender: c.sender, text: c.text }
			})));
		}

			if (!codes.length) {
				this._emit('TWO_FA_NO_CODE', { appName: fieldInfo.appName });
				return;
			}

			// 5. Pick best and gate on confidence
			const best = codes[0];
			log.info('2FA', `Selected code from ${best.source} (${codes.length} available)`);
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

	async _onNotificationReceived(evt) {
		if (this._filling) return;

		const texts = Array.isArray(evt.texts) ? evt.texts : [];
		if (!texts.length) return;

		const allText = texts.join(' ');
		const code = extractOTP(allText);
		if (!code) {
			log.debug('2FA', `Notification text has no OTP: ${allText.slice(0, 80)}`);
			return;
		}
		// Cache the code regardless of fill outcome
		this._codeCache.add({ code, source: 'notifications', sender: 'notification', text: allText, timestamp: Date.now() });

		let fieldInfo = this._lastFieldInfo;
		if (!fieldInfo) {
			log.debug('2FA', 'Notification received with OTP but no cached 2FA field. Attempting to detect field now...');
			fieldInfo = await detect2FAField();
			if (!fieldInfo.detected) {
				log.debug('2FA', 'No 2FA field detected. Code cached for later polling.');
				return;
			}
			log.info('2FA', 'Found 2FA field upon notification arrival');
		}

		// Check dedup
		if (this._recentFills.has(fieldInfo.fingerprint)) return;

		// Build a source result matching gatherCodes shape
		const codeResult = { code, confidence: 0.8, timestamp: Date.now(), source: 'notifications' };
		const overallConfidence = computeConfidence(fieldInfo, codeResult);
		if (overallConfidence < this._confidenceThreshold) {
			this._emit('TWO_FA_LOW_CONFIDENCE', {
				confidence: overallConfidence,
				source: 'notifications',
				threshold: this._confidenceThreshold,
			});
			return;
		}

		this._filling = true;
		try {
			const maskedCode = code.slice(0, 2) + '*'.repeat(code.length - 2);
			log.info('2FA', `Instant-filling ${code.length}-digit code (${maskedCode}) from notification into ${fieldInfo.appName}`);
			this._emit('TWO_FA_FILL_START', {
				source: 'notifications',
				codeLength: code.length,
				app: fieldInfo.appName,
				confidence: overallConfidence,
			});

			const fillResult = await fillCode(code, fieldInfo);
			if (fillResult.ok) {
				this._recentFills.set(fieldInfo.fingerprint, Date.now());
				this._lastFieldInfo = null;
				const verification = await verifyFill();
				this._emit('TWO_FA_FILL_SUCCESS', {
					source: 'notifications',
					method: fillResult.method,
					verified: verification.verified,
				});
				log.info('2FA', `Instant fill success via ${fillResult.method}, verified: ${verification.verified}`);
			} else {
				this._emit('TWO_FA_FILL_FAILED', {
					source: 'notifications',
					error: fillResult.error,
				});
				log.warn('2FA', `Instant fill failed: ${fillResult.error}`);
			}
		} catch (err) {
			log.error('2FA', 'Notification fill error:', err.message);
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
