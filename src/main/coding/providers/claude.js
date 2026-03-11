function createClaudeCodingAdapter() {
	return {
		name: 'claude',
		async run({ prompt, cwd, env = process.env, signal, onLog }) {
			onLog?.('[status] Importing Claude Code SDK...');
			const { query } = await import('@anthropic-ai/claude-agent-sdk');
			onLog?.('[status] SDK ready, starting execution...');

			const cleanEnv = { ...env };
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
						onLog?.(`[stderr] ${String(data || '').trim()}`);
					},
					signal,
				},
			})) {
				if (msg.type === 'assistant') {
					for (const block of msg.message?.content || []) {
						if (block.type === 'text' && block.text) onLog?.(block.text);
						else if (block.type === 'tool_use') onLog?.(`[tool: ${block.name}]`);
					}
				} else if (msg.type === 'tool_use_summary') {
					onLog?.(msg.summary);
				} else if (msg.type === 'result') {
					const status = msg.subtype === 'success' ? 'COMPLETED' : 'FAILED';
					const summary = msg.subtype === 'success'
						? (msg.result || '')
						: (msg.errors?.join(', ') || 'Unknown error');
					return { status, summary };
				}
			}

			return { status: 'COMPLETED', summary: '' };
		},
	};
}

module.exports = { createClaudeCodingAdapter };
