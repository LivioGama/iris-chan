import { EVENT_TYPES } from '../../shared/event-types.web.js';
import { showToolStart, showToolDone, hideToolLog } from '../ui/tool-log.js';
import { updateIfWorkspaceTool } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';

function isSearchTool(name, args) {
	if (name === 'web_search' || name === 'ask_chatgpt' || name === 'research') return true;
	if (name === 'run_terminal_command') {
		const cmd = (args?.command || '').toLowerCase();
		if (cmd.includes('search.py') || cmd.includes('perplexity')) return true;
	}
	if (name.includes('search')) return true;
	return false;
}

function searchLabel(name, args) {
	if (name === 'web_search') return args?.query || 'Searching...';
	if (name === 'ask_chatgpt') return args?.prompt || 'Asking ChatGPT...';
	if (name === 'research') return args?.query || 'Deep researching...';
	if (name === 'run_terminal_command') {
		const m = (args?.command || '').match(/search\.py\s+["']([^"']+)["']/);
		return m ? m[1] : 'Searching...';
	}
	return args?.query || 'Searching...';
}

export function createToolCallHandler({ gemini, onStateChange, onEvent, screen }) {
	const handleToolCalls = async (calls) => {
		onStateChange('TOOL_EXECUTING', true);
		onEvent(EVENT_TYPES.TOOL_START, { tools: calls.map(c => c.name) });

		for (let i = 0; i < calls.length; i++) {
			const { name, args, id } = calls[i];

			showToolStart(name, args, i, calls.length);
			logInfo('Tool', `Executing: ${name}(${JSON.stringify(args || {})})`.slice(0, 500));

			const isSearch = isSearchTool(name, args);
			if (isSearch) {
				window.electronAPI.searchSpinner(searchLabel(name, args));
			}

			const toolStart = Date.now();
			try {
				const result = await window.electronAPI.executeTool(name, args);
				showToolDone(name, i, result.ok !== false);
				updateIfWorkspaceTool(name);
				logInfo('Tool', `Result: ${name} → ${result.ok !== false ? 'OK' : 'FAIL'}: ${(result.result || 'done').slice(0, 300)}`);
				gemini.sendToolResponse(id, name, result.result || 'done');
				window.electronAPI.saveToolExecution(name, args, result.result || 'done', result.ok !== false, Date.now() - toolStart);

				if (isSearch) {
					window.electronAPI.searchResult(searchLabel(name, args), result.ok ? result.result : (result.result || 'Search failed'));
				}
			} catch (err) {
				showToolDone(name, i, false);
				logError('Tool', `Error: ${name} → ${err.message}`);
				gemini.sendToolResponse(id, name, 'Error: ' + err.message);
				window.electronAPI.saveToolExecution(name, args, err.message, false, Date.now() - toolStart);
				if (isSearch) {
					window.electronAPI.searchResult(searchLabel(name, args), 'Error: ' + err.message);
				}
			}
		}

		hideToolLog();

		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			onEvent('VOCAB_CHANGED');
		}

		if (screen) await screen.capture();

		onStateChange('TOOL_EXECUTING', false);
		onEvent(EVENT_TYPES.TOOL_END, { tools: calls.map(c => c.name) });
	};

	return { handleToolCalls };
}
