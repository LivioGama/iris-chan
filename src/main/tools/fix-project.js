const path = require('node:path');
const fs = require('node:fs');
const workspace = require('../workspace');
const { buildCodingPrompt } = require('../coding/prompt');
const { startCodingTask } = require('../coding/runner');

function getIrisDir() {
	return path.resolve(__dirname, '..', '..', '..');
}

async function fix_project(args) {
	const description = args.description || '';
	if (!description) return { ok: false, result: 'No description provided' };
	if (description.length < 30) return { ok: false, result: 'Description too short. Provide detailed context: what to fix/build, expected behavior, files involved. Minimum 30 characters.' };

	const target = args.target || 'workspace';
	// Allow explicit cwd override (e.g., from kanban RUN_TASK to match kanban's tasks.json path)
	const cwd = args._cwd || (target === 'iris' ? getIrisDir() : workspace.get());
	const prompt = buildCodingPrompt({ description, cwd, target });
	const tasksPath = path.join(cwd, 'tasks.json');

	try {
		// Load or create tasks.json
		let data = { version: 1, updatedAt: new Date().toISOString(), tasks: [] };
		if (fs.existsSync(tasksPath)) {
			data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		}
		data.tasks = data.tasks || [];

		let taskId;

		// If taskId provided (from kanban Run button), reuse existing task
		if (args._taskId) {
			taskId = args._taskId;
			const existing = data.tasks.find(t => t.id === taskId);
			if (existing) {
				existing.status = 'IN_PROGRESS';
				existing.logs = '';
				existing.updatedAt = new Date().toISOString();
			}
		} else {
			// Create new task
			let maxId = 0;
			for (const task of data.tasks) {
				if (task.id?.startsWith('task-')) {
					const num = Number.parseInt(task.id.split('-')[1]);
					if (!Number.isNaN(num)) maxId = Math.max(maxId, num);
				}
			}
			taskId = `task-${maxId + 1}`;

			data.tasks.push({
				id: taskId,
				title: description.split('\n')[0].substring(0, 80),
				description,
				status: 'IN_PROGRESS',
				order: data.tasks.length + 1,
				files: [],
				action: '',
				verify: '',
				done: '',
				logs: '',
				dependsOn: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		}

		data.updatedAt = new Date().toISOString();
		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');

		// Fire-and-forget: run SDK in background
		if (args._runSDK) {
			args._runSDK(prompt, cwd, tasksPath, taskId);
		} else {
			runCodingTask(prompt, cwd, tasksPath, taskId);
		}

			const title = description.split('\n')[0].substring(0, 80);
			return {
				ok: true,
				result: `✓ Task queued: ${taskId} — ${title}\nTrack progress in Kanban (Ctrl+K).`
			};
	} catch (err) {
		return { ok: false, result: `fix_project error: ${err.message}` };
	}
}

function runCodingTask(prompt, cwd, tasksPath, taskId) {
	let logBuffer = '';
	let flushTimer = null;

	const flushLogs = () => {
		try {
			const freshData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			const task = (freshData.tasks || []).find(t => t.id === taskId);
			if (task) {
				const lines = logBuffer.split('\n');
				if (lines.length > 50) logBuffer = lines.slice(-50).join('\n');
				task.logs = logBuffer;
				task.updatedAt = new Date().toISOString();
				freshData.updatedAt = new Date().toISOString();
				fs.writeFileSync(tasksPath, JSON.stringify(freshData, null, 2), 'utf8');
			}
		} catch {}
	};

	const updateStatus = (status) => {
		clearTimeout(flushTimer);
		try {
			const freshData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			const task = (freshData.tasks || []).find(t => t.id === taskId);
			if (task) {
				task.status = status;
				task.logs = logBuffer;
				task.updatedAt = new Date().toISOString();
				freshData.updatedAt = new Date().toISOString();
				fs.writeFileSync(tasksPath, JSON.stringify(freshData, null, 2), 'utf8');
			}
		} catch {}
	};

	const handle = startCodingTask({
		taskId,
		prompt,
		cwd,
		onLog: (line, nextLogBuffer) => {
			logBuffer = nextLogBuffer;
			if (!flushTimer) {
				flushTimer = setTimeout(() => {
					flushTimer = null;
					flushLogs();
				}, 2000);
			}
		},
		onDone: ({ status, logBuffer: finalLogBuffer }) => {
			logBuffer = finalLogBuffer;
			updateStatus(status);
		},
	});

	handle.completion.finally(() => {
		clearTimeout(flushTimer);
	});

	return handle;
}

module.exports = { fix_project, getIrisDir };
