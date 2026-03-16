// 2FA Orchestrator: poll loop that detects fields, gathers codes, and fills via TARS
const { detect2FAField } = require('./detector');
const { gatherCodes } = require('./sources');
const { computeConfidence } = require('./confidence');
const { fillWithTars, fillCode, verifyFill } = require('./fill');
const { extractOTP } = require('../tools/auth');
const { NotificationMonitor } = require('./notification-monitor');
const { CodeCache } = require('./code-cache');

let log;
try { log = require('../logger'); } catch {
	log = console;
	log.info = (...a) => console.log('[2FA]', ...a);
	log.debug = (...a) => console.log('[2FA]', ...a);
	log.warn = (...a) => console.warn('[2FA]', ...a);
	log.error = (...a) => console.error('[2FA]', ...a);
}

class TwoFAOrchestrator {
	constructor({ eventBus, behaviorEngine, settings = {} } = {}) {
		this._eventBus = eventBus;
		this._behaviorEngine = behaviorEngine;
		this._pollIntervalMs = settings.pollIntervalMs || 5000;
		this._confidenceThreshold = settings.confidenceThreshold || 0.5;
		this._fillCooldownMs = settings.fillCooldownMs || 60000;
		this._maxCodeAgeSeconds = settings.maxCodeAgeSeconds || 1200;
		this._enabledSources = settings.sources || {};
		this._noCodeBackoffMs = settings.noCodeBackoffMs || 30000;
		this._postFillDelayMs = settings.postFillDelayMs || 5000;
		this._enabled = settings.enabled !== false;

		this._timer = null;
		this._filling = false;
		this._recentFills = new Map(); // fingerprint -> timestamp
		this._noCodeBackoff = null;
		this._lastFieldInfo = null;
		this._codeCache = new CodeCache({ maxAgeMs: this._maxCodeAgeSeconds * 1000 });
		this._fillHistory = []; // codes already filled, avoid re-filling

		// Notification monitor — wrapped so standalone works without Accessibility perms
		this._notifMonitor = null;
		try {
			this._notifMonitor = new NotificationMonitor({
				onNotification: (evt) => this._onNotificationReceived(evt),
			});
		} catch (err) {
			log.warn('2FA', `NotificationMonitor unavailable: ${err.message}`);
		}
	}

	start() {
		if (!this._enabled) {
			log.info('2FA', 'Proactive 2FA disabled in settings');
			return;
		}
		log.info('2FA', `Starting proactive detector (poll: ${this._pollIntervalMs}ms, threshold: ${this._confidenceThreshold})`);
		this._timer = setInterval(() => this._tick(), this._pollIntervalMs);

		if (this._notifMonitor) {
			this._notifMonitor.start().catch(err =>
				log.warn('2FA', `Notification monitor failed to start: ${err.message}`)
			);
		}
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		try { this._notifMonitor?.stop(); } catch { /* ignore */ }
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
		if ('noCodeBackoffMs' in settings) this._noCodeBackoffMs = settings.noCodeBackoffMs;
		if ('postFillDelayMs' in settings) this._postFillDelayMs = settings.postFillDelayMs;

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

	// ── Poll tick ──────────────────────────────────────────────

	async _tick() {
		if (this._filling) return;
		this._filling = true;

		try {
			// Skip if behavior engine says silent (optional dependency)
			const mode = this._behaviorEngine?.getMode?.() ?? this._behaviorEngine?.mode;
			if (mode === 'silent') return;

			// Prune expired fingerprints
			const now = Date.now();
			for (const [fp, ts] of this._recentFills) {
				if (now - ts > this._fillCooldownMs) this._recentFills.delete(fp);
			}

			// No-code backoff: avoid spamming Gemini when field visible but no code available
			if (this._noCodeBackoff && now - this._noCodeBackoff < this._noCodeBackoffMs) {
				log.debug('2FA', `Backing off (${Math.round((this._noCodeBackoffMs - (now - this._noCodeBackoff)) / 1000)}s left)`);
				return;
			}

			// 1. Detect 2FA field (returns { detected, screenshot, ...fieldMeta })
			const fieldInfo = await detect2FAField();
			if (!fieldInfo.detected) {
				this._lastFieldInfo = null;
				return;
			}

			// 2. Dedup — don't re-fill same field
			const fingerprint = `${fieldInfo.appName}:${fieldInfo.windowTitle}:${(fieldInfo.fieldContext || '').slice(0, 100)}`;
			if (this._recentFills.has(fingerprint)) return;

			// 3. Already filled externally?
			if (fieldInfo.focusedValue && fieldInfo.focusedValue.length >= 4) return;

			// Cache field info for notification-driven fills
			this._lastFieldInfo = { ...fieldInfo, fingerprint };

			this._emit('TWO_FA_FIELD_DETECTED', {
				appName: fieldInfo.appName,
				windowTitle: fieldInfo.windowTitle,
				type: fieldInfo.type,
				confidence: fieldInfo.confidence,
			});

			// 4. Gather codes from enabled sources
			log.info('2FA', 'Field detected, gathering codes...');
			const context = {
				appName: fieldInfo.appName,
				windowTitle: fieldInfo.windowTitle,
				maxCodeAgeSeconds: this._maxCodeAgeSeconds,
			};
			const codes = await gatherCodes(context, this._enabledSources);

			// Cache all gathered codes
			for (const c of codes) {
				this._codeCache.add({ code: c.code, source: c.source, sender: c.meta?.sender, text: c.meta?.text, timestamp: c.timestamp });
			}

			// Merge recently cached codes (SMS/notifs that arrived earlier)
			const recentCached = this._codeCache.getLatest(5);
			for (const c of recentCached) {
				if (!codes.some(gc => gc.code === c.code)) {
					codes.push({
						code: c.code,
						source: c.source || 'cache',
						confidence: 0.9,
						timestamp: c.timestamp,
						meta: { sender: c.sender, text: c.text },
					});
				}
			}
			codes.sort((a, b) => (b.confidence - a.confidence) || (b.timestamp - a.timestamp));

			// Filter out codes we already filled
			const fillable = codes.filter(c => !this._fillHistory.includes(c.code));

			if (!fillable.length) {
				log.info('2FA', `No usable codes. Backing off ${this._noCodeBackoffMs / 1000}s.`);
				this._noCodeBackoff = now;
				this._emit('TWO_FA_NO_CODE', { appName: fieldInfo.appName });
				return;
			}

			// 5. Pick best code, gate on confidence
			const best = fillable[0];
			const overallConfidence = computeConfidence(fieldInfo, best);
			if (overallConfidence < this._confidenceThreshold) {
				this._emit('TWO_FA_LOW_CONFIDENCE', {
					confidence: overallConfidence,
					source: best.source,
					threshold: this._confidenceThreshold,
				});
				return;
			}

			// 6. Fill — use TARS with screenshot from detection, fallback to keyboard
			this._noCodeBackoff = null;
			const maskedCode = best.code.slice(0, 2) + '*'.repeat(best.code.length - 2);
			log.info('2FA', `Auto-filling ${best.code.length}-digit code (${maskedCode}) from ${best.source} into ${fieldInfo.appName}`);

			this._emit('TWO_FA_FILL_START', {
				source: best.source,
				codeLength: best.code.length,
				app: fieldInfo.appName,
				confidence: overallConfidence,
			});

			let fillResult;
			if (fieldInfo.screenshot) {
				fillResult = await fillWithTars(best.code, fieldInfo.screenshot, fieldInfo.screenSize || { width: 1920, height: 1080 });
			}
			if (!fillResult || !fillResult.ok) {
				fillResult = await fillCode(best.code, fieldInfo);
			}

			if (fillResult.ok) {
				this._recentFills.set(fingerprint, Date.now());
				this._fillHistory.push(best.code);
				if (this._fillHistory.length > 50) this._fillHistory.shift();

				const verification = await verifyFill();
				this._emit('TWO_FA_FILL_SUCCESS', {
					source: best.source,
					method: fillResult.method,
					verified: verification.verified,
				});
				log.info('2FA', `Fill success via ${fillResult.method}, verified: ${verification.verified}`);

				// Post-fill delay to let the page process before next tick
				await new Promise(r => setTimeout(r, this._postFillDelayMs));
			} else {
				this._emit('TWO_FA_FILL_FAILED', { source: best.source, error: fillResult.error });
				log.warn('2FA', `Fill failed: ${fillResult.error}`);
			}
		} catch (err) {
			log.error('2FA', 'Tick error:', err.message);
		} finally {
			this._filling = false;
		}
	}

	// ── Notification-driven instant fill ───────────────────────

	async _onNotificationReceived(evt) {
		if (this._filling) return;

		const texts = Array.isArray(evt.texts) ? evt.texts : [];
		if (!texts.length) return;

		const allText = texts.join(' ');
		const code = extractOTP(allText);
		if (!code) return;

		// Cache regardless of fill outcome
		this._codeCache.add({ code, source: 'notifications', sender: 'notification', text: allText, timestamp: Date.now() });

		// Skip if we already filled this code
		if (this._fillHistory.includes(code)) return;

		let fieldInfo = this._lastFieldInfo;
		if (!fieldInfo) {
			try {
				fieldInfo = await detect2FAField();
				if (!fieldInfo.detected) return;
				fieldInfo.fingerprint = `${fieldInfo.appName}:${fieldInfo.windowTitle}:${(fieldInfo.fieldContext || '').slice(0, 100)}`;
			} catch {
				return;
			}
		}

		if (this._recentFills.has(fieldInfo.fingerprint)) return;

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

			let fillResult;
			if (fieldInfo.screenshot) {
				fillResult = await fillWithTars(code, fieldInfo.screenshot, fieldInfo.screenSize || { width: 1920, height: 1080 });
			}
			if (!fillResult || !fillResult.ok) {
				fillResult = await fillCode(code, fieldInfo);
			}

			if (fillResult.ok) {
				this._recentFills.set(fieldInfo.fingerprint, Date.now());
				this._fillHistory.push(code);
				if (this._fillHistory.length > 50) this._fillHistory.shift();
				this._lastFieldInfo = null;

				const verification = await verifyFill();
				this._emit('TWO_FA_FILL_SUCCESS', {
					source: 'notifications',
					method: fillResult.method,
					verified: verification.verified,
				});
				log.info('2FA', `Instant fill success via ${fillResult.method}, verified: ${verification.verified}`);

				await new Promise(r => setTimeout(r, this._postFillDelayMs));
			} else {
				this._emit('TWO_FA_FILL_FAILED', { source: 'notifications', error: fillResult.error });
				log.warn('2FA', `Instant fill failed: ${fillResult.error}`);
			}
		} catch (err) {
			log.error('2FA', 'Notification fill error:', err.message);
		} finally {
			this._filling = false;
		}
	}

	// ── Helpers ────────────────────────────────────────────────

	_emit(type, payload) {
		try { this._eventBus?.emitEvent?.(type, payload, 'two-fa'); } catch { /* noop */ }
	}
}

module.exports = { TwoFAOrchestrator };
