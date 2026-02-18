// All ipcMain handler registrations (thin dispatch layer)
const { ipcMain } = require('electron');
const ch = require('../shared/channels');
const toolExecutor = require('./tools');
const screenCapture = require('./screen-capture');
const vocabStore = require('./vocab/store');
const searchWindow = require('./windows/search-window');
const skills = require('./skills');
const avatarWindow = require('./windows/avatar-window');
const log = require('./logger');
const config = require('../shared/config');
const convexStore = require('./convex-store');

function register(apiKey) {
	ipcMain.handle(ch.GET_API_KEY, () => apiKey);
	ipcMain.handle(ch.EXECUTE_TOOL, (_, name, args) => toolExecutor.execute(name, args));
	ipcMain.handle(ch.CAPTURE_SCREEN, () => screenCapture.capture());

	// Vocabulary tracking
	ipcMain.on(ch.TRACK_VOCABULARY, (_, terms) => vocabStore.trackTerms(terms));
	ipcMain.handle(ch.GET_VOCABULARY, () => vocabStore.loadTerms());
	ipcMain.handle(ch.GET_HOT_VOCABULARY, () => Object.keys(vocabStore.loadHot()));
	ipcMain.handle(ch.GET_VOCABULARY_STATS, () => vocabStore.loadStats());
	ipcMain.handle(ch.GET_VOCABULARY_CORRECTIONS, () => vocabStore.loadCorrections());
	ipcMain.handle(ch.GET_VOCABULARY_CORE, () => vocabStore.loadCore());
	ipcMain.on(ch.ADD_CORRECTION, (_, wrong, right) => vocabStore.addCorrection(wrong, right));

	// Search overlay
	ipcMain.on(ch.SEARCH_SPINNER, (_, query) => searchWindow.show(query, null));
	ipcMain.on(ch.SEARCH_RESULT, (_, query, content) => searchWindow.show(query, content));
	ipcMain.on(ch.SEARCH_HIDE, () => searchWindow.hide());

	ipcMain.handle(ch.GET_SKILL_DECLARATIONS, () => skills.getDeclarations());
	ipcMain.handle(ch.GET_SKILL_PROMPTS, () => skills.getSystemPrompts());
	ipcMain.handle(ch.GET_SKILL_CATALOG, () => skills.getCatalog());

	ipcMain.on(ch.SET_IGNORE_MOUSE, (_, ignore) => {
		const win = avatarWindow.get();
		if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
	});

	// Renderer log forwarding
	ipcMain.on(ch.LOG_TO_FILE, (_, level, tag, message) => {
		if (level === 'error') log.error(tag, message);
		else if (level === 'warn') log.warn(tag, message);
		else log.info(tag, message);
	});

	ipcMain.handle(ch.KILL_SKILL, () => skills.killSkill());

	ipcMain.handle(ch.RELOAD_SESSION, () => {
		toolExecutor.reload();
		skills.scan();
		const win = avatarWindow.get();
		if (win) win.webContents.send(ch.RELOAD_SESSION);
		return { ok: true };
	});

	// Avatar configuration
	ipcMain.handle('get-avatar-config', () => config.avatar);

	ipcMain.handle(ch.TOGGLE_AVATAR, () => {
		// Toggle between 'tripo3d' and 'original'
		const current = config.avatar.current;
		config.avatar.current = current === 'tripo3d' ? 'original' : 'tripo3d';
		log.info('Avatar', `Switched to ${config.avatar.current}`);

		// Reload the avatar window
		const win = avatarWindow.get();
		if (win) {
			win.reload();
		}

		return config.avatar.current;
	});

	ipcMain.on(ch.SAVE_CONVERSATION_TURN, (_, role, text) => {
		convexStore.saveTurn(role, text);
	});

	ipcMain.on(ch.SAVE_TOOL_EXECUTION, (_, name, args, result, success, durationMs) => {
		convexStore.saveToolExecution(name, args, result, success, durationMs);
	});

	ipcMain.handle(ch.SEMANTIC_SEARCH, (_, query, limit, roleFilter) => {
		return convexStore.semanticSearch(query, limit, roleFilter);
	});

	ipcMain.on(ch.NEW_CONVEX_SESSION, () => {
		convexStore.newSession();
	});

	ipcMain.on(ch.END_CONVEX_SESSION, () => {
		convexStore.endSession();
	});

	// Kanban tasks
	ipcMain.handle(ch.LOAD_KANBAN_TASKS, () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		try {
			if (!fs.existsSync(tasksPath)) {
				return [];
			}
			const content = fs.readFileSync(tasksPath, 'utf8');
			const data = JSON.parse(content);
			// Extract tasks array from the JSON structure
			return (data.tasks || data) || [];
		} catch (err) {
			log.error('Kanban', `Failed to load tasks.json: ${err.message}`);
			return [];
		}
	});

	ipcMain.handle(ch.SAVE_KANBAN_TASKS, (_, tasks) => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		try {
			const data = {
				version: 1,
				updatedAt: new Date().toISOString(),
				tasks: tasks
			};
			fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
			log.info('Kanban', 'Tasks saved successfully');
			return { ok: true };
		} catch (err) {
			log.error('Kanban', `Failed to save tasks.json: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Run skill by name (e.g., 'ship', 'claude-code-assistant')
	ipcMain.handle(ch.RUN_SKILL, async (_, skillName, args) => {
		try {
			const result = await skills.runSkillByName(skillName, args || {});
			return result;
		} catch (err) {
			return { ok: false, result: `Skill error: ${err.message}` };
		}
	});

	// Run individual task via /ship skill
	ipcMain.handle(ch.RUN_TASK, async (_, taskId) => {
		try {
			// Load task from tasks.json
			const fs = require('node:fs');
			const path = require('node:path');
			const tasksPath = path.join(process.cwd(), 'tasks.json');
			
			if (!fs.existsSync(tasksPath)) {
				return { ok: false, result: 'No tasks file found' };
			}
			
			const content = fs.readFileSync(tasksPath, 'utf8');
			const data = JSON.parse(content);
			const tasks = data.tasks || data;
			const task = tasks.find(t => t.id === taskId);
			
			if (!task) {
				return { ok: false, result: `Task "${taskId}" not found` };
			}
			
			// Run ship skill with the task description
			const result = await skills.runSkillByName('ship', { description: task.description });
			return result;
		} catch (err) {
			return { ok: false, result: `Error running task: ${err.message}` };
		}
	});

	// Remove completed tasks
	ipcMain.handle('remove-completed-tasks', () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		try {
			if (!fs.existsSync(tasksPath)) {
				return { ok: true, removed: 0 };
			}
			
			const content = fs.readFileSync(tasksPath, 'utf8');
			const data = JSON.parse(content);
			const tasks = data.tasks || data;
			
			// Keep only non-DONE tasks
			const remaining = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'DONE');
			const removed = tasks.length - remaining.length;
			
			data.tasks = remaining;
			data.updatedAt = new Date().toISOString();
			
			fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
			log.info('Kanban', `Removed ${removed} completed tasks`);
			
			return { ok: true, removed };
		} catch (err) {
			return { ok: false, error: err.message };
		}
	});

	// Resize kanban window (width + optional height)
	ipcMain.handle(ch.RESIZE_KANBAN, (_, width, height) => {
		const kanbanWindow = require('./windows/kanban-window');
		const win = kanbanWindow.get();
		if (win && !win.isDestroyed()) {
			const bounds = win.getBounds();
			win.setBounds({
				x: bounds.x,
				y: bounds.y,
				width: width || bounds.width,
				height: height || bounds.height,
			}, false);
			return { ok: true };
		}
		return { ok: false, result: 'Kanban window not found' };
	});

	// Show/hide kanban window
	ipcMain.handle('set-kanban-visible', (_, visible) => {
		const kanbanWindow = require('./windows/kanban-window');
		const win = kanbanWindow.get();
		if (win && !win.isDestroyed()) {
			if (visible) win.show();
			else win.hide();
			return { ok: true };
		}
		return { ok: false };
	});

	// Git operations
	ipcMain.handle('git-commit', async (_, message) => {
		const { execSync } = require('node:child_process');
		try {
			execSync('git add .', { cwd: process.cwd() });
			execSync(`git commit -m "${message || 'Update tasks'}"`, { cwd: process.cwd() });
			log.info('Kanban', 'Git commit successful');
			return { ok: true };
		} catch (err) {
			log.warn('Kanban', `Git commit failed: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	ipcMain.handle('git-push', async () => {
		const { execSync } = require('node:child_process');
		try {
			execSync('git push', { cwd: process.cwd() });
			log.info('Kanban', 'Git push successful');
			return { ok: true };
		} catch (err) {
			log.warn('Kanban', `Git push failed: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Sync tasks to Convex
	ipcMain.handle('sync-tasks-to-convex', async (_, tasks) => {
		try {
			// Store tasks in Convex for history/audit trail
			// This is one-way sync: kanban → Convex
			for (const task of tasks) {
				await convexStore.saveTurn('system', `Task: ${task.id} - ${task.title} (${task.status})`);
			}
			log.info('Kanban', `Synced ${tasks.length} tasks to Convex`);
			return { ok: true };
		} catch (err) {
			log.warn('Kanban', `Convex sync failed: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Update task logs
	ipcMain.handle('update-task-logs', async (_, taskId, logs) => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		try {
			if (!fs.existsSync(tasksPath)) {
				return { ok: false, error: 'Tasks file not found' };
			}
			
			const content = fs.readFileSync(tasksPath, 'utf8');
			const data = JSON.parse(content);
			const tasks = data.tasks || data;
			const task = tasks.find(t => t.id === taskId);
			
			if (task) {
				task.logs = logs;
				data.tasks = tasks;
				data.updatedAt = new Date().toISOString();
				fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
				log.info('Kanban', `Updated logs for task ${taskId}`);
				return { ok: true };
			}
			return { ok: false, error: 'Task not found' };
		} catch (err) {
			log.error('Kanban', `Failed to update task logs: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Check if spec.md exists
	ipcMain.handle('spec-md-exists', () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const specPath = path.join(process.cwd(), 'spec.md');
		return { exists: fs.existsSync(specPath) };
	});

	ipcMain.handle('tasks-file-exists', () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		return { exists: fs.existsSync(tasksPath) };
	});

	// Write spec.md from aggregated tasks
	ipcMain.handle('write-spec-md', async (_, spec) => {
		const fs = require('node:fs');
		const path = require('node:path');
		const specPath = path.join(process.cwd(), 'spec.md');
		
		try {
			fs.writeFileSync(specPath, spec, 'utf8');
			log.info('Kanban', 'Wrote spec.md');
			return { ok: true };
		} catch (err) {
			log.error('Kanban', `Failed to write spec.md: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Delete tasks.json file
	ipcMain.handle('delete-tasks-file', async () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		try {
			if (fs.existsSync(tasksPath)) {
				fs.unlinkSync(tasksPath);
				log.info('Kanban', 'Deleted tasks.json');
			}
			return { ok: true };
		} catch (err) {
			log.error('Kanban', `Failed to delete tasks.json: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Import log files into Convex database
	ipcMain.handle(ch.IMPORT_LOGS, async (_, filePaths) => {
		const fs = require('node:fs');
		const os = require('node:os');
		let imported = 0;
		const errors = [];

		for (const filePath of filePaths) {
			try {
				if (!fs.existsSync(filePath)) {
					errors.push(`${filePath}: not found`);
					continue;
				}
				const content = fs.readFileSync(filePath, 'utf-8');
				const lines = content.split('\n').filter(l => l.trim());

				for (const line of lines) {
					// Try to parse structured log lines
					const match = line.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*)\]\s*\[?(USER|IRIS|SYSTEM|INFO|ERROR|WARN)\]?\s*(.*)/i);
					if (match) {
						const role = match[2].toLowerCase() === 'user' ? 'user' : 'iris';
						const text = match[3].trim();
						if (text.length > 2) {
							await convexStore.saveTurn(role, text);
							imported++;
						}
					} else if (line.length > 10) {
						// Unstructured line — save as system context
						await convexStore.saveTurn('iris', line.trim());
						imported++;
					}
				}
				log.info('Import', `Imported ${lines.length} lines from ${filePath}`);
			} catch (err) {
				errors.push(`${filePath}: ${err.message}`);
			}
		}

		return { ok: errors.length === 0, imported, errors };
	});

	// Parse spec.md and recreate tasks.json
	ipcMain.handle('parse-spec-md', async () => {
		const fs = require('node:fs');
		const path = require('node:path');
		const specPath = path.join(process.cwd(), 'spec.md');
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		log.info('Kanban', `[parse-spec-md] Starting parse, spec path: ${specPath}`);
		
		try {
			if (!fs.existsSync(specPath)) {
				log.warn('Kanban', `[parse-spec-md] spec.md not found at ${specPath}`);
				return { ok: false, error: 'spec.md not found' };
			}
			
			const spec = fs.readFileSync(specPath, 'utf8');
			log.info('Kanban', `[parse-spec-md] spec.md read successfully (${spec.length} bytes)`);
			const tasks = [];
			let taskId = 1;
			
			// Parse spec.md: each task starts with "## Title" followed by description
			const lines = spec.split('\n');
			let i = 0;
			while (i < lines.length) {
				const line = lines[i];
				
				// Look for title line starting with ##
				if (line.startsWith('## ')) {
					const title = line.substring(3).trim();
					i++;
					
					// Collect description lines until next ## or end
					const descriptionLines = [];
					while (i < lines.length && !lines[i].startsWith('## ')) {
						const descLine = lines[i].trim();
						if (descLine) {
							descriptionLines.push(descLine);
						}
						i++;
					}
					
					const description = descriptionLines.join(' ');
					
					if (title && description) {
						tasks.push({
							id: `task-${taskId}`,
							title: title.length > 70 ? `${title.substring(0, 67)}...` : title,
							description: description.length > 500 ? `${description.substring(0, 497)}...` : description,
							status: 'PENDING',
							order: taskId,
							files: [],
							action: '',
							verify: '',
							done: '',
							dependsOn: [],
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString()
						});
						taskId++;
					}
				} else {
					i++;
				}
			}
			
			log.info('Kanban', `[parse-spec-md] Parsed ${tasks.length} tasks from spec.md`);
			
			// Write tasks.json
			const data = {
				version: 1,
				updatedAt: new Date().toISOString(),
				tasks: tasks
			};
			fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
			log.info('Kanban', `[parse-spec-md] Wrote ${tasks.length} tasks to ${tasksPath}`);
			
			return { ok: true, count: tasks.length };
		} catch (err) {
			log.error('Kanban', `[parse-spec-md] Failed: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});
}

module.exports = { register };
