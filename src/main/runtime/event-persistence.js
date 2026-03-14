class RuntimeEventPersistence {
	constructor({ eventBus, convexClient }) {
		this.eventBus = eventBus;
		this.convexClient = convexClient;
		this.runtimeEventSeq = 0;
	}

	start() {
		this.eventBus.on('event', (evt) => {
			this.handleEvent(evt).catch(() => {});
		});
	}

	async handleEvent(evt) {
		const idempotencyKey = `runtime_evt_${evt.timestamp}_${this.runtimeEventSeq++}_${evt.type}`;
		const serializedEvent = {
			type: evt.type,
			timestamp: evt.timestamp,
			payload: JSON.stringify(evt.payload || {}),
			source: evt.source || 'runtime',
		};

		await this.convexClient.saveRuntimeEvent(serializedEvent, idempotencyKey);

		if (evt.type === 'TASK_MILESTONE' || evt.type === 'TASK_DONE') {
			const taskId = evt.payload?.taskId || 'unknown';
			await this.convexClient.saveTaskMilestone({
				taskId,
				message: evt.payload?.message || '',
				importance: evt.payload?.importance || 'medium',
				status: evt.payload?.status,
				timestamp: evt.timestamp,
			}, `task_milestone_${taskId}_${evt.timestamp}`);
		}

		if (evt.type === 'PROACTIVE_SUGGESTION') {
			await this.convexClient.saveProactiveSuggestion({
				text: evt.payload?.suggestion || evt.payload?.text || '',
				confidence: Number(evt.payload?.confidence || 0),
				context: JSON.stringify({
					kind: evt.payload?.kind || 'next-step',
					...(evt.payload?.context || {}),
				}),
				accepted: evt.payload?.accepted,
				timestamp: evt.timestamp,
			}, `proactive_${evt.timestamp}`);
		}
	}
}

module.exports = { RuntimeEventPersistence };
