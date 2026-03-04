const log = require('../logger');

const avatarWindow = require('../windows/avatar-window');

function emitStream(type, data) {
	const payload = { type, ...data };
	const win = avatarWindow.get();
	if (win) win.webContents.send('claude-code-stream', payload);
	try {
		const kanbanWindow = require('../windows/kanban-window');
		const kWin = kanbanWindow.get();
		if (kWin) kWin.webContents.send('claude-code-stream', payload);
	} catch {}
}

async function executeTask(taskId, prompt, projectPath, onLog) {
	log.info('TaskQueue', `Starting execution for ${taskId} in ${projectPath}`);
	let logBuffer = '';

	const appendLog = (line) => {
		logBuffer += (logBuffer ? '\n' : '') + line;
		if (onLog) onLog(line);
		emitStream('log', { taskId, line });
	};

	try {
		const { query } = await import('@anthropic-ai/claude-agent-sdk');
		appendLog('Task execution started.');

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
				cwd: projectPath,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch'],
				env: cleanEnv,
				stderr: (data) => {
					log.error('TaskQueue', `SDK stderr: ${data}`);
					appendLog(`[stderr] ${data.trim()}`);
				},
			}
		})) {
			if (msg.type === 'assistant') {
				for (const block of msg.message?.content || []) {
					if (block.type === 'text' && block.text) appendLog(block.text);
					else if (block.type === 'tool_use') appendLog(`[tool: ${block.name}]`);
				}
			} else if (msg.type === 'tool_use_summary') {
				appendLog(msg.summary);
			} else if (msg.type === 'result') {
				const status = msg.subtype === 'success' ? 'done' : 'failed';
				const resultText = msg.subtype === 'success' ? (msg.result || '') : (msg.errors?.join(', ') || 'Unknown error');
				appendLog(`${status === 'done' ? '✅' : '❌'} ${status.toUpperCase()}: ${resultText}`);
				emitStream('done', { taskId, status, summary: resultText || logBuffer.slice(-500) });
				return { ok: true, status, summary: resultText || logBuffer.slice(-500) };
			}
		}

		appendLog('✅ Completed');
		emitStream('done', { taskId, status: 'done', summary: logBuffer.slice(-500) });
		return { ok: true, status: 'done', summary: logBuffer.slice(-500) };
	} catch (err) {
		log.error('TaskQueue', `Execution error: ${err.stack || err.message}`);
		appendLog(`❌ Error: ${err.message}`);
		emitStream('done', { taskId, status: 'failed', summary: `Error: ${err.message}` });
		return { ok: false, status: 'failed', summary: `Error: ${err.message}` };
	}
}

module.exports = { executeTask };
