// Tool schemas as pure data — imported by client.js
export const toolDeclarations = [
	{
		name: 'type_text',
		description: 'Type text into the currently focused input field on the user\'s computer',
		parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
	},
	{
		name: 'press_key',
		description: 'Press a keyboard key or combo. Supported: return, space, escape, tab, delete, up, down, left, right, single letters a-z, or combos like cmd+c, ctrl+shift+a',
		parameters: { type: 'OBJECT', properties: { key: { type: 'STRING' } }, required: ['key'] },
	},
	{
		name: 'run_terminal_command',
		description: 'Run a shell command in the terminal and return the output',
		parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] },
	},
	{
		name: 'open_app',
		description: 'Open a macOS application by name (e.g. Safari, Finder, Terminal, Notes)',
		parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
	},
	{
		name: 'scroll',
		description: 'Scroll the current page or view up or down',
		parameters: { type: 'OBJECT', properties: { direction: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['direction'] },
	},
	{
		name: 'click_at',
		description: 'Click at screen coordinates. Use button "right" for right-click, default is left-click. Use the screenshot to estimate coordinates.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, button: { type: 'STRING' } }, required: ['x', 'y'] },
	},
	{
		name: 'double_click',
		description: 'Double-click at screen coordinates (e.g. to select a word or open a file).',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
	},
	{
		name: 'mouse_move',
		description: 'Move the mouse cursor to screen coordinates without clicking.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
	},
	{
		name: 'drag',
		description: 'Drag from one point to another (e.g. to move a window, select text, or drag files).',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, x2: { type: 'NUMBER' }, y2: { type: 'NUMBER' } }, required: ['x', 'y', 'x2', 'y2'] },
	},
	{
		name: 'get_mouse_position',
		description: 'Get the current mouse cursor position as x,y coordinates.',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'clipboard_read',
		description: 'Read the current clipboard text content.',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'clipboard_write',
		description: 'Write text to the clipboard.',
		parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
	},
	{
		name: 'web_search',
		description: 'Search the web using Ollama Cloud with gpt-oss-120b. Use this for any web search, research, looking up current information, facts, news, documentation, or answering questions that need up-to-date data. Returns a concise, structured summary of search results. Prefer this over ask_chatgpt for research.',
		parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The search query \u2014 be specific and descriptive' } }, required: ['query'] },
	},
	{
		name: 'ask_chatgpt',
		description: 'Send a prompt to the ChatGPT macOS desktop app and get a response. Fallback for complex multi-step research. For simple web searches, prefer the web_search tool instead.',
		parameters: { type: 'OBJECT', properties: { prompt: { type: 'STRING' } }, required: ['prompt'] },
	},
	{
		name: 'notify',
		description: 'Show a macOS notification to the user with a message.',
		parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
	},
	{
		name: 'propose_reply',
		description: 'Type a reply into a messaging app input field. After typing, ask the user to confirm before pressing return to send.',
		parameters: { type: 'OBJECT', properties: { reply: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ['reply'] },
	},
	{
		name: 'set_volume',
		description: 'Set the system audio volume. Level is 0.0 (mute) to 1.0 (max).',
		parameters: { type: 'OBJECT', properties: { level: { type: 'NUMBER' } }, required: ['level'] },
	},
	{
		name: 'get_frontmost_app',
		description: 'Get the name and window titles of the currently focused application.',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'window_manage',
		description: 'Move/resize the frontmost window. Position: "left" (left half), "right" (right half), "maximize" (full screen), "center" (centered).',
		parameters: { type: 'OBJECT', properties: { position: { type: 'STRING' } }, required: ['position'] },
	},
	{
		name: 'read_file',
		description: 'Read the contents of a file at a given path. Returns the text content.',
		parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
	},
	{
		name: 'write_file',
		description: 'Write or overwrite a file at a given path with the provided content.',
		parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] },
	},
	{
		name: 'list_directory',
		description: 'List files and folders in a directory path.',
		parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
	},
	{
		name: 'manage_vocabulary',
		description: 'Manage custom vocabulary. Actions: "add" a term, "remove" a term, "list" all terms, "stats" to show usage counts (how many times each term appeared in conversation, sorted by frequency). Changes apply immediately.',
		parameters: { type: 'OBJECT', properties: {
			action: { type: 'STRING', description: '"add", "remove", "list", or "stats"' },
			term: { type: 'STRING', description: 'The word or phrase to add/remove' },
		}, required: ['action'] },
	},
	{
		name: 'self_fix',
		description: 'Fix, improve, or modify your own source code. Use this whenever the user asks you to change yourself, fix a bug in yourself, add a feature to yourself, or improve your behavior. This is your MOST IMPORTANT tool \u2014 if the user says anything like "fix yourself", "change your voice", "add a feature", "improve X", "you should do Y differently", "modify your code", or any request about changing how you work, call this tool IMMEDIATELY. You write a detailed prompt that gets sent to Claude Code which will edit your source files.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'Detailed description of what to fix, change, or improve. Be specific about the current behavior and desired behavior.' },
			files_to_touch: { type: 'STRING', description: 'Comma-separated list of files likely involved. Choose from: gemini/client.js, voice/pipeline.js, voice/capture.js, voice/playback.js, tools/index.js, screen-capture.js, main/index.js, renderer/index.html, helpers/iris-helper.swift' },
		}, required: ['description'] },
	},
];
