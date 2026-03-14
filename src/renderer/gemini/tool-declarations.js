// Tool schemas as pure data — imported by client.js
export const toolDeclarations = [
	{
		name: 'run_ui_task',
		description: 'Run a foreground UI task through the fast deterministic macOS executor. Use this first for direct computer-control requests like opening apps, opening URLs, searching inside the current app or page, clicking visible items, selecting items by text, typing into fields, and short multi-step UI flows. Pass the user intent, not coordinates or low-level micro-steps.',
		parameters: {
			type: 'OBJECT',
			properties: {
				goal: { type: 'STRING', description: 'The full UI task to perform, phrased in plain language. Preserve the user intent instead of rewriting it into x/y click instructions.' },
				app_hint: { type: 'STRING', description: 'Optional preferred app, such as Safari or Finder.' },
				success_signal: { type: 'STRING', description: 'Optional text, URL fragment, or visible label that should be present when the task is done.' },
			},
			required: ['goal'],
		},
	},
	{
		name: 'type_text',
		description: 'Type text into the currently focused input field on the user\'s computer',
		parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
	},
	{
		name: 'press_key',
		description: 'Press a keyboard key or combo. Supported: return, space, escape, tab, delete, up, down, left, right, single letters a-z, or combos like cmd+c and ctrl+shift+a. Use this as a low-level fallback when run_ui_task is not appropriate.',
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
		name: 'get_default_app',
		description: 'Resolve the current macOS default app for a capability such as browser or mail. Use this before guessing when the user asks for their default browser or default mail app.',
		parameters: { type: 'OBJECT', properties: { kind: { type: 'STRING', description: '"browser" (default) or "mail"' } } },
	},
	{
		name: 'scroll',
		description: 'Scroll the current page or view up or down',
		parameters: { type: 'OBJECT', properties: { direction: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['direction'] },
	},
	{
		name: 'click_at',
		description: 'Click at image pixel coordinates from a specific screenshot. Use button "right" for right-click, default is left-click. x and y are pixel positions in the screenshot image. Always pass the capture_id from the latest [SCREEN CONTEXT] message.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, button: { type: 'STRING' }, capture_id: { type: 'STRING', description: 'The capture ID from the [SCREEN CONTEXT] message that supplied these coordinates.' } }, required: ['x', 'y'] },
	},
	{
		name: 'double_click',
		description: 'Double-click at image pixel coordinates from a specific screenshot (e.g. to select a word or open a file). Always pass the capture_id from the latest [SCREEN CONTEXT] message.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, capture_id: { type: 'STRING', description: 'The capture ID from the [SCREEN CONTEXT] message that supplied these coordinates.' } }, required: ['x', 'y'] },
	},
	{
		name: 'mouse_move',
		description: 'Move the mouse cursor to image pixel coordinates from a specific screenshot, without clicking. Always pass the capture_id from the latest [SCREEN CONTEXT] message.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, capture_id: { type: 'STRING', description: 'The capture ID from the [SCREEN CONTEXT] message that supplied these coordinates.' } }, required: ['x', 'y'] },
	},
	{
		name: 'drag',
		description: 'Drag from one point to another using image pixel coordinates from a specific screenshot (e.g. to move a window, select text, or drag files). Always pass the capture_id from the latest [SCREEN CONTEXT] message.',
		parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, x2: { type: 'NUMBER' }, y2: { type: 'NUMBER' }, capture_id: { type: 'STRING', description: 'The capture ID from the [SCREEN CONTEXT] message that supplied these coordinates.' } }, required: ['x', 'y', 'x2', 'y2'] },
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
		description: 'Search the web using Perplexity with explicit source provenance. Use this for any web search, research, looking up current information, facts, news, documentation, or answering questions that need up-to-date data. Returns a concise, structured summary plus sources.',
		parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The search query \u2014 be specific and descriptive' } }, required: ['query'] },
	},
	{
		name: 'notify',
		description: 'Show a macOS notification to the user with a message.',
		parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
	},
	{
		name: 'check_permissions',
		description: 'Check whether Iris currently has the permissions needed for screen interaction, including Screen Recording and Accessibility.',
		parameters: { type: 'OBJECT', properties: {} },
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
			source: { type: 'STRING', description: 'Full path of the file or folder to move (e.g. ~/Desktop/my-folder)' },
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
		name: 'create_skill',
		description: 'Create or revise an installed Iris skill under ~/.iris/skills with match criteria, preferred execution path, fallback path, and replacement metadata. Use when the user explicitly asks to create a skill or when Iris is packaging a learned workflow.',
		parameters: { type: 'OBJECT', properties: {
			purpose: { type: 'STRING', description: 'Human-readable purpose of the skill.' },
			app_scope: { type: 'STRING', description: 'Optional app scope, such as Safari or Finder.' },
			trigger_source: { type: 'STRING', description: 'Origin of the skill, such as user-requested, repeated-pattern, or failure-driven.' },
			source_goal: { type: 'STRING', description: 'The user intent or canonical goal the skill should match.' },
			match_criteria: { type: 'OBJECT', description: 'Optional structured match criteria including appNames, intents, and keywords.' },
			preferred_execution_path: { type: 'OBJECT', description: 'Preferred execution path, typically a stored UI plan.' },
			fallback_path: { type: 'OBJECT', description: 'Optional fallback path metadata.' },
			lane: { type: 'STRING', description: 'Execution lane: "skill" (default), "core", "memory", "safety", or "research-observability".' },
			hireable_profile: { type: 'STRING', description: 'Optional hireable profile slug for the lane, such as "memory-architect" or "safety-guardian".' },
		}, required: ['purpose'] },
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
		name: 'query_settings',
		description: 'Query existing runtime-tunable Iris settings in ~/.iris/settings.json without modifying source code. Use this for read-only settings questions such as listing voice presets, checking the current voice/avatar/mode, or reading logging/direct-mode status.',
		parameters: { type: 'OBJECT', properties: {
			request: { type: 'STRING', description: 'Natural-language read-only settings query like "what voice presets do you have", "what voice are you using", or "is direct mode on".' },
		}, required: ['request'] },
	},
	{
		name: 'update_settings',
		description: 'Update existing runtime-tunable Iris settings in ~/.iris/settings.json without modifying source code. Prefer this over self_fix whenever the request is already covered by stable settings. Supports changing voice presets, switching voices by preset name, and tuning voice characteristics like pitch, playback rate, EQ warmth/brightness, and compression, along with other settings-backed behavior such as avatar, behavior mode, direct mode, and logging.',
		parameters: { type: 'OBJECT', properties: {
			patch: { type: 'STRING', description: 'Optional JSON object patch for ~/.iris/settings.json.' },
			key: { type: 'STRING', description: 'Optional single settings key path like voice.modelVoiceName.' },
			value: { type: 'STRING', description: 'Optional value paired with key.' },
			request: { type: 'STRING', description: 'Optional natural-language mutation request like "switch to soft bloom" or "make it warmer and slower". Read-only questions should use query_settings.' },
		} },
	},
	{
		name: 'self_fix',
		description: 'Fix, improve, or modify your own source code. Use this whenever the user gives you a SPECIFIC change request about yourself \u2014 "fix yourself", "change your voice", "add a feature", "improve X", "you should do Y differently", "modify your code". Prefer update_settings when an existing stable setting already covers the request. If self_fix adds a new user-tunable behavior, it must also define a stable setting in ~/.iris/settings.json. CRITICAL: Only call this when you have a CONCRETE description of what to change. Do NOT call this for vague intent announcements like "I\'m going to change you" or "attends je vais te changer" \u2014 for those, acknowledge and wait for specifics first. Claude Code runs directly on the project files \u2014 no kanban tasks or remote execution involved.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'Detailed description of what to fix, change, or improve. MUST be specific \u2014 include current behavior, desired behavior, likely files, and for new tunable behaviors the settings key/default/live-apply expectation under ~/.iris/settings.json. Minimum 50 characters. Do NOT pass vague intents like "the user wants to change me".' },
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
		name: 'add_task',
		description: 'Add a task to the autonomous queue for any project. Auto-detects the project from what the user is hovering in Finder/IDE. The task will be enriched with project context via Gemini Flash, reviewed with a 10-second countdown, then executed autonomously by Claude Code SDK. Use when user says "add task", "queue this", "do this later", etc.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'What to do — can be vague, it will be enriched with project context automatically.' },
			project_path: { type: 'STRING', description: 'Optional absolute path to the project. If omitted, auto-detected from what the user is hovering.' },
			execution_lane: { type: 'STRING', description: 'Optional queue lane: "skill", "memory", "safety", "research-observability", or "core".' },
			hireable_profile: { type: 'STRING', description: 'Optional hireable profile slug for the queued work.' },
			queue_bucket: { type: 'STRING', description: 'Optional queue bucket label used to group queued work inside a lane.' },
		}, required: ['description'] },
	},
	{
		name: 'extract_tasks',
		description: 'Silently extract and queue actionable tasks detected during conversation. Call this proactively when the user mentions work items, to-dos, bugs, or things to build — without being explicitly asked. Do not announce or confirm extraction verbally; tasks appear silently in the kanban board.',
		parameters: {
			type: 'OBJECT',
			properties: {
				tasks: {
					type: 'ARRAY',
					description: 'Array of structured tasks to extract and queue.',
					items: {
						type: 'OBJECT',
						properties: {
							title: { type: 'STRING', description: 'Short task title (under 80 chars).' },
							description: { type: 'STRING', description: 'Full task description with conversational context.' },
							priority: { type: 'STRING', description: '"low", "medium", "high", or "urgent". Default "medium".' },
							dependencies: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Titles of other tasks this depends on (from this batch or existing tasks).' },
							project_path: { type: 'STRING', description: 'Absolute path to relevant project. Omit to auto-detect from workspace.' },
							execution_lane: { type: 'STRING', description: 'Queue lane: "skill", "memory", "safety", "research-observability", or "core".' },
						},
						required: ['title', 'description'],
					},
				},
			},
			required: ['tasks'],
		},
	},
	{
		name: 'list_mounted_installers',
		description: 'List all currently mounted installer disk images (non-system volumes). Shows each volume name and the source .dmg file path. Use before cleanup to see what installers are mounted.',
		parameters: { type: 'OBJECT', properties: {} },
	},
	{
		name: 'recall_link',
		description: 'Search your saved link history using natural language. Use when the user asks "what was that article about X?", "find that link about Y", "do you remember that page about Z?", or wants to browse previously seen links. Returns matching links ranked by relevance.',
		parameters: { type: 'OBJECT', properties: {
			query: { type: 'STRING', description: 'Natural language description of the link to find, e.g. "React performance article" or "that YouTube video about cooking"' },
			domain: { type: 'STRING', description: 'Optional domain filter, e.g. "github.com" or "youtube.com"' },
			limit: { type: 'NUMBER', description: 'Max results to return (default 5, max 10)' },
		}, required: ['query'] },
	},
	{
		name: 'open_link',
		description: 'Open a previously seen link in the default browser. Can find the link by natural language query or by direct URL. Use when the user says "open that link about X", "go to that article about Y", or "take me to that page".',
		parameters: { type: 'OBJECT', properties: {
			query: { type: 'STRING', description: 'Natural language description to find the link, e.g. "that React article"' },
			url: { type: 'STRING', description: 'Direct URL to open (skips search if provided)' },
		} },
	},
	{
		name: 'save_observation',
		description: 'Save a visual observation of what is currently on screen to persistent memory. Call this when: (1) you detect the user switched to a different app, (2) you see an error/crash/exception on screen, (3) the user says "remember this" or "note what you see", or (4) you receive an [OBSERVATION TRIGGER] message. Do not speak when calling this automatically.',
		parameters: { type: 'OBJECT', properties: {
			description: { type: 'STRING', description: 'Brief 1-3 sentence description of what is visible on screen right now. Focus on the app, content/task, and notable state.' },
			app_name: { type: 'STRING', description: 'Name of the frontmost application (e.g. "Safari", "VS Code", "Terminal")' },
			tags: { type: 'STRING', description: 'Comma-separated tags for the observation (e.g. "code,github,pull-request" or "error,terminal,crash")' },
			trigger: { type: 'STRING', description: '"app_switch", "periodic", "user_requested", or "error_detected"' },
			note: { type: 'STRING', description: 'Optional user-provided context about what to remember' },
		}, required: ['description', 'app_name', 'tags', 'trigger'] },
	},
	{
		name: 'recall_observations',
		description: 'Search your persistent visual memory for past screen observations. Use when the user asks about what they were looking at, what you have seen, what was on screen earlier, or references past visual content.',
		parameters: { type: 'OBJECT', properties: {
			query: { type: 'STRING', description: 'What to search for in visual memory, e.g. "that error in Terminal" or "the pull request in Safari"' },
			app_filter: { type: 'STRING', description: 'Optional app name to narrow search' },
			limit: { type: 'NUMBER', description: 'Max results (default: 5)' },
		}, required: ['query'] },
	},
];
