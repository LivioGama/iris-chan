import { info as logInfo } from '../logger.js';

export function createClaudeCodeBatcher({ gemini }) {
	const entries = new Map();
	let cleanupInterval = null;

	const addLine = (taskId, line) => {
		const now = Date.now();
		if (!entries.has(taskId)) {
			entries.set(taskId, { lines: [], lastSent: 0, createdAt: now });
		}
		const entry = entries.get(taskId);
		entry.lines.push(line);
		if (entry.lines.length > 100) entry.lines = entry.lines.slice(-50);

		if (now - entry.lastSent > 30000 && gemini?.sessionReady) {
			entry.lastSent = now;
			const recent = entry.lines.slice(-10).join('\n');
			entry.lines = [];
			gemini.sendText(
				`[CLAUDE CODE UPDATE — ${taskId}]\n` +
				`Recent activity:\n${recent}\n\n` +
				'If the user asks about progress, share this update conversationally. Otherwise stay quiet.'
			);
		}
	};

	const handleDone = (taskId, status, summary) => {
		entries.delete(taskId);
		if (gemini?.sessionReady) {
			gemini.sendText(
				`[CLAUDE CODE FINISHED — ${taskId}]\n` +
				`Status: ${status}\n` +
				`Summary:\n${summary || 'No details'}\n\n` +
				'Tell the user briefly that the task finished and share the result. ' +
				'If it failed, explain what went wrong.'
			);
		}
	};

	const purgeStale = () => {
		const now = Date.now();
		for (const [taskId, entry] of entries) {
			if (now - (entry.createdAt || 0) > 300000 && entry.lines.length === 0) {
				entries.delete(taskId);
				logInfo('Batcher', `Purged stale log: ${taskId}`);
			}
		}
	};

	const start = () => {
		stop();
		cleanupInterval = setInterval(purgeStale, 60000);
	};

	const stop = () => {
		if (cleanupInterval) {
			clearInterval(cleanupInterval);
			cleanupInterval = null;
		}
		entries.clear();
	};

	return { addLine, handleDone, start, stop };
}
