const path = require('node:path');
const os = require('node:os');
const { EVENT_TYPES } = require('../../shared/event-types.js');
const { createJsonStore } = require('../../shared/json-store');
const { buildDailyDraft } = require('./daily-draft-summary');

const LOOP_STATE_PATH = path.join(os.homedir(), '.iris', 'daily-loop.json');
const loopStore = createJsonStore(LOOP_STATE_PATH, { lastRunDate: null });

function todayKey() {
	const now = new Date();
	// Keep the key on the local calendar day; UTC ISO dates roll back near local midnight.
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
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

		const draft = buildDailyDraft({ date: today });
		const draftResult = await this.createGhostDraft({
			apiUrl: process.env.GHOST_ADMIN_URL || '',
			adminApiKey: process.env.GHOST_ADMIN_API_KEY || '',
			title: draft.title,
			html: draft.html,
			tags: ['iris', 'daily'],
		});

		if (draftResult.ok) {
			await loopStore.set('lastRunDate', today);
			this.convexClient.saveDailyDraft({
				title: draft.title,
				date: today,
				ghostId: draftResult.draft?.id || null,
				status: 'draft',
				summary: draft.summary,
			}, `daily_draft_${today}`).catch(() => {});
		}
	}
}

module.exports = { DailyLoop, LOOP_STATE_PATH };
