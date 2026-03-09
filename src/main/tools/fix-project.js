// Tool handler: fix_project — fix any project via Claude Code JS SDK
const path = require('node:path');
const fs = require('node:fs');
const workspace = require('../workspace');

function getIrisDir() {
	return path.resolve(__dirname, '..', '..', '..');
}

// Send streaming update to all windows (avatar + kanban) for live logs
function emitStream(type, data) {
	const payload = { type, ...data };
	try {
		const win = require('../windows/avatar-window').get();
		if (win) win.webContents.send('claude-code-stream', payload);
	} catch {}
	// Also send to kanban window for live log display
	try {
		const kanbanWindow = require('../windows/kanban-window');
		const kWin = kanbanWindow.get();
		if (kWin) kWin.webContents.send('claude-code-stream', payload);
	} catch {}
}

async function fix_project(args) {
	const description = args.description || '';
	if (!description) return { ok: false, result: 'No description provided' };
	if (description.length < 30) return { ok: false, result: 'Description too short. Provide detailed context: what to fix/build, expected behavior, files involved. Minimum 30 characters.' };

	const target = args.target || 'workspace';
	// Allow explicit cwd override (e.g., from kanban RUN_TASK to match kanban's tasks.json path)
	const cwd = args._cwd || (target === 'iris' ? getIrisDir() : workspace.get());
	const runTask = args._runSDK || runSDK;

	const prompt = buildPrompt(description, cwd, target);
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
		runTask(prompt, cwd, tasksPath, taskId);

			const title = description.split('\n')[0].substring(0, 80);
			return {
				ok: true,
				result: `✓ Task queued: ${taskId} — ${title}\nTrack progress in Kanban (Ctrl+K).`
			};
	} catch (err) {
		return { ok: false, result: `fix_project error: ${err.message}` };
	}
}

function buildPrompt(description, cwd, target) {
	let context = '';

	// Read CLAUDE.md if exists
	const claudeMdPath = path.join(cwd, 'CLAUDE.md');
	if (fs.existsSync(claudeMdPath)) {
		try {
			context += `Project instructions (CLAUDE.md):\n${fs.readFileSync(claudeMdPath, 'utf8').substring(0, 3000)}\n\n`;
		} catch {}
	}

	// Read package.json name/description
	const pkgPath = path.join(cwd, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			context += `Project: ${pkg.name || 'unknown'} — ${pkg.description || ''}\n\n`;
		} catch {}
	}

	return `Working directory: ${cwd}
Target: ${target}
${context}
Task:
${description}

Instructions: Work autonomously. Edit files directly. Run lint/typecheck after changes. Do not ask questions — make reasonable decisions and proceed.`;
}

async function runSDK(prompt, cwd, tasksPath, taskId) {
	const log = require('../logger');
	log.info('FixProject', `Starting SDK for ${taskId} in ${cwd}`);
	let logBuffer = '';
	let flushTimer = null;
	let heartbeatTimer = null;
	let lastMessageTime = Date.now();

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

	const onLog = (line) => {
		logBuffer += (logBuffer ? '\n' : '') + line;
		lastMessageTime = Date.now();
		// Stream to renderer for Iris to see
		emitStream('log', { taskId, line });
		if (!flushTimer) {
			flushTimer = setTimeout(() => {
				flushTimer = null;
				flushLogs();
			}, 2000);
		}
	};

	const updateStatus = (status) => {
		clearTimeout(flushTimer);
		clearInterval(heartbeatTimer);
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

	// Heartbeat: emit periodic status so the renderer knows we're still alive
	heartbeatTimer = setInterval(() => {
		const elapsed = Math.round((Date.now() - lastMessageTime) / 1000);
		emitStream('log', { taskId, line: `[heartbeat] alive — ${elapsed}s since last SDK message` });
	}, 30000);

	try {
		log.info('FixProject', 'Importing SDK...');
		onLog('[status] Importing Claude Code SDK...');
		const { query } = await import('@anthropic-ai/claude-agent-sdk');
		log.info('FixProject', 'SDK imported, starting query...');
		onLog('[status] SDK ready, starting execution...');

		// Clean env to avoid conflicts with parent Claude Code session
		const cleanEnv = { ...process.env };
		for (const key of Object.keys(cleanEnv)) {
			if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
				delete cleanEnv[key];
			}
		}

		for await (const msg of query({
			prompt,
			options: {
				cwd,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch'],
				env: cleanEnv,
				stderr: (data) => {
					log.error('FixProject', `SDK stderr: ${data}`);
					onLog(`[stderr] ${data.trim()}`);
				},
			}
		})) {
			lastMessageTime = Date.now();
			log.info('FixProject', `SDK msg: type=${msg.type} subtype=${msg.subtype || ''}`);
			if (msg.type === 'assistant') {
				for (const block of msg.message?.content || []) {
					if (block.type === 'text' && block.text) onLog(block.text);
					else if (block.type === 'tool_use') onLog(`[tool: ${block.name}]`);
				}
			} else if (msg.type === 'tool_use_summary') {
				onLog(msg.summary);
			} else if (msg.type === 'result') {
				const status = msg.subtype === 'success' ? 'COMPLETED' : 'FAILED';
				const resultText = msg.subtype === 'success' ? (msg.result || '') : (msg.errors?.join(', ') || 'Unknown error');
				logBuffer += `\n${status === 'COMPLETED' ? '✅' : '❌'} ${status}: ${resultText}`;
				updateStatus(status);
				emitStream('done', { taskId, status, summary: resultText || logBuffer.slice(-500) });
				return;
			}
		}

		// If we exit the loop without a result message
		logBuffer += '\n✅ Completed';
		updateStatus('COMPLETED');
		emitStream('done', { taskId, status: 'COMPLETED', summary: logBuffer.slice(-500) });
	} catch (err) {
		log.error('FixProject', `SDK error: ${err.stack || err.message}`);
		logBuffer += `\n❌ Error: ${err.message}`;
		onLog(`❌ Error: ${err.message}`);
		updateStatus('FAILED');
		emitStream('done', { taskId, status: 'FAILED', summary: `Error: ${err.message}` });
	} finally {
		clearInterval(heartbeatTimer);
		clearTimeout(flushTimer);
	}
}

module.exports = { fix_project, getIrisDir };
