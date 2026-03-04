const path = require('node:path');
const os = require('node:os');
const { EVENT_TYPES } = require('../../shared/event-types.js');
const { createJsonStore } = require('../../shared/json-store');

const LOOP_STATE_PATH = path.join(os.homedir(), '.iris', 'daily-loop.json');
const loopStore = createJsonStore(LOOP_STATE_PATH, { lastRunDate: null });

function todayKey() {
	return new Date().toISOString().slice(0, 10);
}

class DailyLoop {
	constructor({ taskEngine, createGhostDraft, convexClient, eventBus }) {
		this.taskEngine = taskEngine;
		this.createGhostDraft = createGhostDraft;
		this.convexClient = convexClient;
		this.eventBus = eventBus;
		this.timer = null;
		this.pausedForPriority = false;
	}

	start() {
		if (this.timer) return;
		this.timer = setInterval(() => this.tick(), 60 * 60 * 1000);
		this.tick();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async tick() {
		const lastRunDate = await loopStore.get('lastRunDate');
		const today = todayKey();
		if (lastRunDate === today) return;

		const hasHighPriority = this.taskEngine.hasHighPriorityRunning();
		if (hasHighPriority) {
			if (!this.pausedForPriority) {
				this.pausedForPriority = true;
				this.eventBus.emitEvent(EVENT_TYPES.TASK_MILESTONE, {
					taskId: 'daily-loop',
					message: 'Daily loop paused for high-priority task.',
					importance: 'medium',
					status: 'running',
				}, 'daily-loop');
			}
			return;
		}

		if (this.pausedForPriority) {
			this.pausedForPriority = false;
			this.eventBus.emitEvent(EVENT_TYPES.TASK_MILESTONE, {
				taskId: 'daily-loop',
				message: 'High-priority task cleared, daily loop resumed.',
				importance: 'medium',
				status: 'running',
			}, 'daily-loop');
		}

		const title = `Iris Daily Note — ${today}`;
		const html = `<p>Short daily learning note for ${today}. Key insight: iterate with evidence, then simplify.</p>`;
		const draftResult = await this.createGhostDraft({
			apiUrl: process.env.GHOST_ADMIN_URL || '',
			adminApiKey: process.env.GHOST_ADMIN_API_KEY || '',
			title,
			html,
			tags: ['iris', 'daily'],
		});

		if (draftResult.ok) {
			await loopStore.set('lastRunDate', today);
			this.convexClient.saveDailyDraft({
				title,
				date: today,
				ghostId: draftResult.draft?.id || null,
				status: 'draft',
			}, `daily_draft_${today}`).catch(() => {});
		}
	}
}

module.exports = { DailyLoop, LOOP_STATE_PATH };
