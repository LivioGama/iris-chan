const { EVENT_TYPES } = require('../../shared/event-types.js');

class HealthService {
	constructor({ convexClient, taskEngine, skillEngine, eventBus }) {
		this.convexClient = convexClient;
		this.taskEngine = taskEngine;
		this.skillEngine = skillEngine;
		this.eventBus = eventBus;
		this.lastLatencyMs = -1;
		this._timer = null;
	}

	async _probeDb() {
		try {
			if (!this.convexClient?.healthCheck) {
				return { ok: false, latencyMs: -1, retryCount: 0, error: 'Convex client unavailable' };
			}
			return await this.convexClient.healthCheck();
		} catch (err) {
			return {
				ok: false,
				latencyMs: -1,
				retryCount: 0,
				error: err?.message || 'Unknown health check error',
			};
		}
	}

	_safeStatus(label, getter) {
		try {
			return getter();
		} catch {
			return `${label}-degraded`;
		}
	}

	async getHealth() {
		const db = await this._probeDb();
		this.lastLatencyMs = db.latencyMs;
		this.eventBus?.emitEvent?.(EVENT_TYPES.DB_HEALTH, db, 'health-service');
		return {
			voice: 'ok',
			db: db.ok ? 'ok' : 'degraded',
			tasks: this._safeStatus('tasks', () => this.taskEngine.getHealth()),
			skills: this._safeStatus('skills', () => this.skillEngine.getHealth()),
			latencyMs: db.latencyMs,
			dbError: db.ok ? undefined : db.error || 'Health check failed',
		};
	}

	start(intervalMs = 60000) {
		if (this._timer) return;
		const tick = () => this.getHealth().catch(() => {});
		tick();
		this._timer = setInterval(tick, intervalMs);
	}

	stop() {
		if (!this._timer) return;
		clearInterval(this._timer);
		this._timer = null;
	}
}

module.exports = { HealthService };
