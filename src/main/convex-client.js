const MAX_RETRIES = 4;
const BASE_DELAY_MS = 350;

class ConvexClient {
	constructor({ eventBus = null } = {}) {
		this.eventBus = eventBus;
		this.url = process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL || '';
		this.adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY || '';
	}

	async _run(functionName, args) {
		if (!this.url) {
			return { ok: false, error: 'No Convex URL configured' };
		}

		const apiPath = functionName.replace(':', '/');
		let retries = 0;
		let lastError = null;
		const startedAt = Date.now();

		while (retries <= MAX_RETRIES) {
			try {
				const body = { args };
				if (this.adminKey) body.adminKey = this.adminKey;

				const res = await fetch(`${this.url}/api/run/${apiPath}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});

				const json = await res.json();
				if (!res.ok || json.status === 'error') {
					throw new Error(json.errorMessage || `HTTP ${res.status}`);
				}
				return {
					ok: true,
					value: json.value,
					latencyMs: Date.now() - startedAt,
					retryCount: retries,
				};
			} catch (err) {
				lastError = err;
				if (retries === MAX_RETRIES) break;
				const backoff = BASE_DELAY_MS * Math.pow(2, retries);
				await new Promise((resolve) => setTimeout(resolve, backoff));
				retries += 1;
			}
		}

		return {
			ok: false,
			error: lastError ? lastError.message : 'Unknown error',
			latencyMs: Date.now() - startedAt,
			retryCount: retries,
		};
	}

	async healthCheck() {
		const result = await this._run('conversations:getRecent', { limit: 1 });
		return {
			ok: result.ok,
			latencyMs: result.latencyMs ?? -1,
			retryCount: result.retryCount ?? 0,
			error: result.error,
		};
	}

	async saveRuntimeEvent(event, idempotencyKey) {
		return this._run('runtime:saveRuntimeEvent', { event, idempotencyKey });
	}

	async saveTaskMilestone(taskMilestone, idempotencyKey) {
		return this._run('runtime:saveTaskMilestone', { taskMilestone, idempotencyKey });
	}

	async saveProactiveSuggestion(suggestion, idempotencyKey) {
		return this._run('runtime:saveProactiveSuggestion', { suggestion, idempotencyKey });
	}

	async saveDailyDraft(draft, idempotencyKey) {
		return this._run('runtime:saveDailyDraft', { draft, idempotencyKey });
	}

	async verifyHistoryImport() {
		const runtimeCheck = await this._run('runtime:verifyHistoryImport', {});
		if (runtimeCheck.ok) {
			return { ok: true, summary: runtimeCheck.value };
		}

		const fallback = await this._run('conversations:getRecent', { limit: 5000 });
		if (!fallback.ok) return fallback;

		const recent = Array.isArray(fallback.value) ? fallback.value : [];
		const imported = recent.filter((row) => row?.source === 'historical' || row?.source === 'curated');
		return {
			ok: true,
			summary: {
				recentCount: recent.length,
				importedCount: imported.length,
				hasImportedHistory: imported.length > 0,
				latestTimestamp: recent[0]?.timestamp ?? null,
				viaFallback: true,
			},
		};
	}
}

module.exports = { ConvexClient };
