import { EVENT_TYPES } from '../../shared/event-types.web.js';
import { showToolStart, showToolDone, hideToolLog } from '../ui/tool-log.js';
import { updateIfWorkspaceTool } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';

// Tools that return immediately (fire-and-forget in main process).
// These must NOT block voice capture or enter TOOL_EXECUTING state.
const BACKGROUND_TOOLS = new Set(['fix_project', 'self_fix', 'add_task']);

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
	const _executeOne = async (name, args, id, index, total) => {
		showToolStart(name, args, index, total);
		logInfo('Tool', `Executing: ${name}(${JSON.stringify(args || {})})`.slice(0, 500));

		const isSearch = isSearchTool(name, args);
		if (isSearch) {
			window.electronAPI.searchSpinner(searchLabel(name, args));
		}

		const toolStart = Date.now();
		try {
			const result = await window.electronAPI.executeTool(name, args);
			showToolDone(name, index, result.ok !== false);
			updateIfWorkspaceTool(name);
			logInfo('Tool', `Result: ${name} → ${result.ok !== false ? 'OK' : 'FAIL'}: ${(result.result || 'done').slice(0, 300)}`);
			gemini.sendToolResponse(id, name, result.result || 'done');
			window.electronAPI.saveToolExecution(name, args, result.result || 'done', result.ok !== false, Date.now() - toolStart);

			if (isSearch) {
				window.electronAPI.searchResult(searchLabel(name, args), result.ok ? result.result : (result.result || 'Search failed'));
			}
		} catch (err) {
			showToolDone(name, index, false);
			logError('Tool', `Error: ${name} → ${err.message}`);
			gemini.sendToolResponse(id, name, 'Error: ' + err.message);
			window.electronAPI.saveToolExecution(name, args, err.message, false, Date.now() - toolStart);
			if (isSearch) {
				window.electronAPI.searchResult(searchLabel(name, args), 'Error: ' + err.message);
			}
		}
	};

	const handleToolCalls = async (calls) => {
		// Split calls into background (fire-and-forget) and blocking (synchronous) groups
		const bgCalls = [];
		const blockingCalls = [];
		for (const call of calls) {
			if (BACKGROUND_TOOLS.has(call.name)) {
				bgCalls.push(call);
			} else {
				blockingCalls.push(call);
			}
		}

		onEvent(EVENT_TYPES.TOOL_START, { tools: calls.map(c => c.name) });

		// Background tools: execute WITHOUT blocking voice engine.
		// They resolve quickly (fire-and-forget in main process) and send their
		// tool response to Gemini independently.
		if (bgCalls.length > 0) {
			logInfo('Tool', `Dispatching ${bgCalls.length} background tool(s) without blocking voice`);
			for (let i = 0; i < bgCalls.length; i++) {
				const { name, args, id } = bgCalls[i];
				// Execute asynchronously — do NOT await, do NOT set TOOL_EXECUTING
				_executeOne(name, args, id, i, bgCalls.length).catch(err => {
					logError('Tool', `Background tool ${name} dispatch error: ${err.message}`);
				});
			}
		}

		// Blocking tools: execute sequentially with TOOL_EXECUTING state (blocks voice capture).
		if (blockingCalls.length > 0) {
			onStateChange('TOOL_EXECUTING', true);

			for (let i = 0; i < blockingCalls.length; i++) {
				const { name, args, id } = blockingCalls[i];
				await _executeOne(name, args, id, i, blockingCalls.length);
			}

			onStateChange('TOOL_EXECUTING', false);
		}

		hideToolLog();

		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			onEvent('VOCAB_CHANGED');
		}

		if (screen) await screen.capture();

		onEvent(EVENT_TYPES.TOOL_END, { tools: calls.map(c => c.name) });
	};

	return { handleToolCalls };
}
