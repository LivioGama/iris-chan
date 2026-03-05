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

	async getHealth() {
		const db = await this.convexClient.healthCheck();
		this.lastLatencyMs = db.latencyMs;
		this.eventBus.emitEvent(EVENT_TYPES.DB_HEALTH, db, 'health-service');
		return {
			voice: 'ok',
			db: db.ok ? 'ok' : 'degraded',
			tasks: this.taskEngine.getHealth(),
			skills: this.skillEngine.getHealth(),
			latencyMs: db.latencyMs,
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
