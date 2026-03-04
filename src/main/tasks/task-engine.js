const { EventEmitter } = require('node:events');
const { EVENT_TYPES } = require('../../shared/event-types.js');

function classifyRestart(filesTouched = []) {
	if (!filesTouched.length) return 'hot';
	for (const file of filesTouched) {
		if (!file) continue;
		if (file.startsWith('src/main/tools/') || file.startsWith('/Users/') && file.includes('/.iris/skills/')) {
			continue;
		}
		return 'cold';
	}
	return 'hot';
}

class TaskEngine extends EventEmitter {
	constructor({ eventBus }) {
		super();
		this.eventBus = eventBus;
		this.running = new Map();
	}

	getHealth() {
		return 'ok';
	}

	buildSelfFixDescription({ problem, desiredBehavior, files, implementation, context }) {
		return [
			`PROBLEM: ${problem || 'Not provided'}`,
			`DESIRED BEHAVIOR: ${desiredBehavior || 'Not provided'}`,
			`FILES: ${(files || []).join(', ') || 'Not provided'}`,
			`IMPLEMENTATION: ${implementation || 'Not provided'}`,
			`CONTEXT: ${context || 'Not provided'}`,
		].join(' ');
	}

	getSelfFixAck() {
		return 'On it.';
	}

	runTask(taskId, payload = {}) {
		const now = Date.now();
		const handle = {
			taskId,
			status: 'running',
			startedAt: now,
			payload,
			restartClass: classifyRestart(payload.filesTouched || []),
			verified: false,
			verificationRequired: payload.requiresPostVerification === true,
		};
		this.running.set(taskId, handle);
		this.eventBus.emitEvent(EVENT_TYPES.TASK_MILESTONE, {
			taskId,
			message: `Task ${taskId} started`,
			importance: 'medium',
			status: 'running',
		}, 'task-engine');
		this.emit('task-stream', { taskId, type: 'milestone', message: 'started' });
		return { ok: true, taskId, restartClass: handle.restartClass };
	}

	markVerified(taskId, details = 'Post-change verification passed') {
		const task = this.running.get(taskId);
		if (!task) return { ok: false, error: `Task ${taskId} not running` };
		task.verified = true;
		this.eventBus.emitEvent(EVENT_TYPES.TASK_MILESTONE, {
			taskId,
			message: details,
			importance: 'high',
			status: 'running',
		}, 'task-engine');
		this.emit('task-stream', { taskId, type: 'milestone', message: details });
		return { ok: true };
	}

	stopTask(taskId) {
		const task = this.running.get(taskId);
		if (!task) return { ok: false, error: `Task ${taskId} not running` };
		task.status = 'cancelled';
		this.running.delete(taskId);
		this.eventBus.emitEvent(EVENT_TYPES.TASK_DONE, {
			taskId,
			message: `Task ${taskId} stopped`,
			importance: 'high',
			status: 'cancelled',
		}, 'task-engine');
		this.emit('task-stream', { taskId, type: 'done', status: 'cancelled' });
		return { ok: true };
	}

	completeTask(taskId, summary = 'done', options = {}) {
		const task = this.running.get(taskId);
		if (!task) return { ok: false, error: `Task ${taskId} not running` };
		if (task.verificationRequired && !task.verified && !options.force) {
			const blockedMsg = 'Completion blocked until post-change verification passes';
			this.eventBus.emitEvent(EVENT_TYPES.TASK_MILESTONE, {
				taskId,
				message: blockedMsg,
				importance: 'high',
				status: 'running',
			}, 'task-engine');
			this.emit('task-stream', { taskId, type: 'milestone', message: blockedMsg });
			return { ok: false, error: blockedMsg };
		}
		task.status = 'completed';
		this.running.delete(taskId);
		const payload = {
			taskId,
			message: summary,
			importance: 'high',
			status: 'completed',
		};
		this.eventBus.emitEvent(EVENT_TYPES.TASK_DONE, payload, 'task-engine');
		this.emit('task-stream', { taskId, type: 'done', status: 'completed', summary });
		return { ok: true };
	}

	hasHighPriorityRunning() {
		return Array.from(this.running.values()).some((t) => t.payload?.priority === 'high');
	}

	subscribeStream(listener) {
		this.on('task-stream', listener);
		return () => this.off('task-stream', listener);
	}
}

module.exports = { TaskEngine, classifyRestart };
