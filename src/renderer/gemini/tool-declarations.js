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
		name: 'tars_action',
		description: 'Use a vision model to find and interact with UI elements precisely. Much more accurate than guessing coordinates. Call with a natural language instruction describing the target element. Optionally pass text to type after clicking the element. Use this for ALL UI interactions: clicking buttons, selecting items, opening menus, closing dialogs, typing into specific fields.',
		parameters: { type: 'OBJECT', properties: {
			instruction: { type: 'STRING', description: 'Natural language instruction. Be descriptive. Examples: "click the message input field", "click the Send button", "click the X button to close the popup".' },
			text: { type: 'STRING', description: 'Optional: text to type AFTER finding and clicking the target element.' },
		}, required: ['instruction'] },
	},
	{
		name: 'click_at',
		description: 'DEPRECATED — prefer tars_action for accurate clicks. Click at image pixel coordinates from the screenshot. Use button "right" for right-click, default is left-click. x and y are pixel positions in the screenshot image.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, button: { type: 'STRING' } }, required: ['x', 'y'] },
	},
	{
		name: 'double_click',
		description: 'Double-click at image pixel coordinates from the screenshot (e.g. to select a word or open a file).',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
	},
	{
		name: 'mouse_move',
		description: 'Move the mouse cursor to image pixel coordinates from the screenshot, without clicking.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
	},
	{
		name: 'drag',
		description: 'Drag from one point to another using image pixel coordinates from the screenshot (e.g. to move a window, select text, or drag files).',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, x2: { type: 'NUMBER' }, y2: { type: 'NUMBER' } }, required: ['x', 'y', 'x2', 'y2'] },
	},
	{
		name: 'get_mouse_position',
		description: 'Get the current mouse cursor position as x,y image pixel coordinates (same coordinate space as click_at, mouse_move, drag).',
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
		name: 'move_file',
		description: 'Move or rename a file or folder. To determine the source path: look at the Finder window title bar for the current directory, or use list_directory to confirm the full path. If the user is looking at a folder in Finder, the window title shows the parent directory — combine it with the folder name to get the source path. Works across volumes.',
		parameters: { type: 'OBJECT', properties: {
			source: { type: 'STRING', description: 'Full path of the file or folder to move (e.g. /Users/livio/Desktop/my-folder)' },
			destination: { type: 'STRING', description: 'Full path of the destination. If a directory, the item is moved into it keeping its name. If a new path, the item is renamed/moved to that exact path.' },
		}, required: ['source', 'destination'] },
	},
	{
		name: 'get_finder_selection',
		description: 'Get the currently selected file(s) or folder(s) in Finder. Returns their full POSIX paths. If nothing is selected, returns the current Finder window directory. Use this BEFORE move_file when the user refers to a visible or selected folder (e.g. "move this folder", "install this skill").',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'download_browser_image',
		description: 'Download the largest/most prominent image from the currently focused browser tab. Supports Safari and any Chromium-based browser (Chrome, Arc, Comet, Brave, Edge, etc.). Saves to ~/Desktop by default. Use when the user asks to save, download, or grab an image they are looking at in their browser.',
		parameters: { type: 'OBJECT', properties: {
			path: { type: 'STRING', description: 'Optional save path. Defaults to ~/Desktop/browser_image.png' },
		} },
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
		name: 'set_workspace',
		description: 'Set the current workspace directory. All relative file paths and terminal commands will use this as the base directory. Persists across relaunches. Use when the user says "work in this folder", "cd to X", "switch to project X", or when starting work on a specific project.',
		parameters: { type: 'OBJECT', properties: {
			directory: { type: 'STRING', description: 'Absolute path to the directory to use as workspace' },
		}, required: ['directory'] },
	},
	{
		name: 'get_workspace',
		description: 'Get the current workspace directory. Returns the directory used as the base for relative paths and terminal commands.',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'use_skill',
		description: 'Load and execute an installed skill by name. Call this when the user asks for something that matches an installed skill. Returns the skill\'s full instructions — then follow them using your existing tools (run_terminal_command, etc.). Check the skill catalog in your system prompt to see available skills.',
		parameters: { type: 'OBJECT', properties: {
			skill_name: { type: 'STRING', description: 'Name of the skill to load (from the catalog)' },
		}, required: ['skill_name'] },
	},
	{
		name: 'fix_project',
		description: 'Fix, improve, or build features in ANY project (current workspace or Iris herself). Uses Claude Code directly via JS SDK with full autonomy. Use for workspace projects when user asks to "fix this", "add this feature", "improve this code". For Iris self-modifications, prefer self_fix.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'Detailed description of what to fix/build. Include current behavior, desired behavior, files involved.' },
			target: { type: 'STRING', description: '"workspace" (default, uses current workspace dir) or "iris" (Iris-chan source code)' },
		}, required: ['description'] },
	},
	{
		name: 'self_fix',
		description: 'Fix, improve, or modify your own source code. Use this whenever the user gives you a SPECIFIC change request about yourself \u2014 "fix yourself", "change your voice", "add a feature", "improve X", "you should do Y differently", "modify your code". This is your MOST IMPORTANT tool. CRITICAL: Only call this when you have a CONCRETE description of what to change. Do NOT call this for vague intent announcements like "I\'m going to change you" or "attends je vais te changer" \u2014 for those, acknowledge and wait for specifics first. Claude Code runs directly on the project files \u2014 no kanban tasks or remote execution involved.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'Detailed description of what to fix, change, or improve. MUST be specific \u2014 include current behavior, desired behavior, and likely files. Minimum 50 characters. Do NOT pass vague intents like "the user wants to change me".' },
			files_to_touch: { type: 'STRING', description: 'Comma-separated list of files likely involved. Choose from: gemini/client.js, voice/voice-engine.js, voice/capture.js, voice/playback.js, tools/index.js, screen-capture.js, main/index.js, renderer/index.html, helpers/iris-helper.swift' },
		}, required: ['description'] },
	},
	{
		name: 'auto_2fa',
		description: 'Automatically retrieve a 2FA/verification code from recent Messages (iMessage/SMS), Mail, or notifications and type it into the currently focused input field. Use when you see a 2FA input field on screen or the user asks you to handle a verification code. Checks the last 5 minutes of messages by default.',
		parameters: { type: 'OBJECT', properties: {
			source: { type: 'STRING', description: '"auto" (default, checks all), "messages" (iMessage/SMS only), "mail" (Mail.app only), "notifications" (Notification Center only)' },
			auto_type: { type: 'BOOLEAN', description: 'Whether to automatically type the code into the focused field (default: true)' },
			max_age_seconds: { type: 'NUMBER', description: 'How far back to search in seconds (default: 300 = 5 minutes)' },
		} },
	},
	{
		name: 'import_logs',
		description: 'Import conversation log files from Desktop into the Convex conversation database for message history persistence. Reads consolidated_messages.log, iris_conversation.log, and Iris_Message_Log.txt by default.',
		parameters: { type: 'OBJECT', properties: {
			files: { type: 'STRING', description: 'Optional comma-separated list of file paths to import. Defaults to the 3 standard log files on Desktop.' },
		} },
	},
	{
		name: 'execute_setup',
		description: 'Load and execute a setup script — a list of instructions stored in ~/.iris/setups/. Each setup is a .md file with numbered steps. Without a name, lists available setups. With a name, loads the instructions for step-by-step execution. Use when the user says "execute the setup", "run setup X", "do the setup", etc.',
		parameters: { type: 'OBJECT', properties: {
			name: { type: 'STRING', description: 'Name of the setup to load (without .md extension). Omit to list available setups.' },
		} },
	},
	{
		name: 'add_task',
		description: 'Add a task to the autonomous queue for any project. Auto-detects the project from what the user is hovering in Finder/IDE. The task will be enriched with project context via Gemini Flash, reviewed with a 10-second countdown, then executed autonomously by Claude Code SDK. Use when user says "add task", "queue this", "do this later", etc.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'What to do — can be vague, it will be enriched with project context automatically.' },
			project_path: { type: 'STRING', description: 'Optional absolute path to the project. If omitted, auto-detected from what the user is hovering.' },
		}, required: ['description'] },
	},
];
