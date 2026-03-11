function formatTodoItems(items = []) {
	return items.map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('\n');
}

function emitTextDelta(onLog, cache, id, nextText) {
	const prevText = cache.get(id) || '';
	if (nextText.length > prevText.length) {
		const delta = nextText.slice(prevText.length).trim();
		if (delta) onLog?.(delta);
	}
	cache.set(id, nextText);
}

function emitCommandOutput(onLog, cache, item) {
	const prevOutput = cache.get(item.id) || '';
	const nextOutput = String(item.aggregated_output || '');
	if (nextOutput.length > prevOutput.length) {
		const delta = nextOutput.slice(prevOutput.length).trim();
		if (delta) onLog?.(delta);
	}
	cache.set(item.id, nextOutput);
}

function emitItemEvent(onLog, cache, event) {
	const item = event.item;
	if (!item) return null;
	switch (item.type) {
		case 'reasoning':
			emitTextDelta(onLog, cache, item.id, String(item.text || ''));
			return null;
		case 'agent_message':
			emitTextDelta(onLog, cache, item.id, String(item.text || ''));
			return String(item.text || '');
		case 'command_execution':
			if (event.type === 'item.started') {
				onLog?.(`[tool: Bash] ${item.command}`);
			}
			emitCommandOutput(onLog, cache, item);
			return null;
		case 'web_search':
			if (event.type === 'item.started') onLog?.(`[tool: WebSearch] ${item.query}`);
			return null;
		case 'mcp_tool_call':
			if (event.type === 'item.started') onLog?.(`[tool: ${item.server}/${item.tool}]`);
			if (event.type === 'item.completed' && item.error?.message) {
				onLog?.(`[stderr] ${item.error.message}`);
			}
			return null;
		case 'file_change':
			if (event.type === 'item.completed') {
				const summary = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ');
				if (summary) onLog?.(`[tool: Edit] ${summary}`);
			}
			return null;
		case 'todo_list': {
			const nextText = formatTodoItems(item.items || []);
			emitTextDelta(onLog, cache, item.id, nextText);
			return null;
		}
		case 'error':
			onLog?.(`[stderr] ${item.message}`);
			return null;
		default:
			return null;
	}
}

function createCodexCodingAdapter() {
	return {
		name: 'codex',
		async run({ prompt, cwd, env = process.env, signal, onLog }) {
			onLog?.('[status] Importing Claude Code SDK...');
			const { Codex } = await import('@openai/codex-sdk');
			onLog?.('[status] SDK ready, starting execution...');

			const cleanEnv = { ...env };
			for (const key of Object.keys(cleanEnv)) {
				if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
					delete cleanEnv[key];
				}
			}

			const codex = new Codex({
				apiKey: cleanEnv.CODEX_API_KEY || cleanEnv.OPENAI_API_KEY || undefined,
				env: cleanEnv,
			});
			const thread = codex.startThread({
				workingDirectory: cwd,
				sandboxMode: 'danger-full-access',
				approvalPolicy: 'never',
				skipGitRepoCheck: true,
				networkAccessEnabled: true,
			});
			const streamed = await thread.runStreamed(prompt, { signal });
			const cache = new Map();
			let finalResponse = '';

			for await (const event of streamed.events) {
				if (event.type === 'turn.failed') {
					throw new Error(event.error?.message || 'Codex turn failed');
				}
				if (event.type === 'error') {
					throw new Error(event.message || 'Codex stream failed');
				}
				if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
					const maybeFinalResponse = emitItemEvent(onLog, cache, event);
					if (maybeFinalResponse) finalResponse = maybeFinalResponse;
				}
			}

			return { status: 'COMPLETED', summary: finalResponse };
		},
	};
}

module.exports = { createCodexCodingAdapter };
