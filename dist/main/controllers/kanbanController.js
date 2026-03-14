"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogService = getCatalogService;
exports.register = register;
const electron_1 = require("electron");
const ch = __importStar(require("../../shared/channels"));
const kanbanWindow = __importStar(require("../windows/kanban-window"));
const log = __importStar(require("../logger"));
const convexStore = __importStar(require("../convex-store"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const taskState = require('../tasks/task-state');
const { TaskCatalogService } = require('../tasks/task-catalog-service');
const { FileTaskRepository } = require('../tasks/repositories/file-task-repository');
const { QueueTaskRepository } = require('../tasks/repositories/queue-task-repository');
let catalogService = null;
function getCatalogService() {
    if (!catalogService) {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        const fileRepo = new FileTaskRepository(tasksPath, { cwd: process.cwd() });
        const { getConvexClient } = require('../runtime/convex-adapter');
        const queueRepo = new QueueTaskRepository(getConvexClient(), { projectPath: process.cwd() });
        catalogService = new TaskCatalogService({ fileRepo, queueRepo, kanbanWindow });
    }
    return catalogService;
}
const KANBAN_GIT_PATHS = ['tasks.json', 'spec.md'];
function runGit(args, cwd) {
    return (0, child_process_1.execFileSync)('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}
function isTrackedGitPath(filePath, cwd) {
    try {
        (0, child_process_1.execFileSync)('git', ['ls-files', '--error-unmatch', '--', filePath], {
            cwd,
            stdio: 'ignore',
        });
        return true;
    }
    catch {
        return false;
    }
}
function getKanbanPathsToStage(cwd) {
    return KANBAN_GIT_PATHS.filter((filePath) => {
        return fs_1.default.existsSync(path_1.default.join(cwd, filePath)) || isTrackedGitPath(filePath, cwd);
    });
}
function getGitErrorMessage(err) {
    const stderr = typeof err?.stderr === 'string'
        ? err.stderr.trim()
        : Buffer.isBuffer(err?.stderr)
            ? err.stderr.toString('utf8').trim()
            : '';
    const stdout = typeof err?.stdout === 'string'
        ? err.stdout.trim()
        : Buffer.isBuffer(err?.stdout)
            ? err.stdout.toString('utf8').trim()
            : '';
    return stderr || stdout || err?.message || 'Unknown git error';
}
function register() {
    // Kanban tasks
    electron_1.ipcMain.handle(ch.LOAD_KANBAN_TASKS, async () => {
        try {
            return await getCatalogService().getAllTasks();
        }
        catch (err) {
            log.error('Kanban', `Failed to load reconciled tasks: ${err.message}`);
            return [];
        }
    });
    electron_1.ipcMain.handle(ch.SAVE_KANBAN_TASKS, (_, tasks) => {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        try {
            taskState.writeTasksFile(tasksPath, {
                version: 1,
                tasks: tasks.map((task) => taskState.normalizeTaskRecord(task, { cwd: process.cwd() })),
            });
            log.info('Kanban', 'Tasks saved successfully');
            return { ok: true };
        }
        catch (err) {
            log.error('Kanban', `Failed to save tasks.json: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Run individual task via Claude Code Agent SDK with live streaming logs
    electron_1.ipcMain.handle(ch.RUN_TASK, async (_, taskId) => {
        const fixProject = require('../tools/fix-project');
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        if (!fs_1.default.existsSync(tasksPath)) {
            return { ok: false, result: 'No tasks file found' };
        }
        try {
            const data = taskState.loadTasksFile(tasksPath, { cwd: process.cwd() });
            const tasks = data.tasks;
            const task = tasks.find(t => t.id === taskId);
            if (!task) {
                return { ok: false, result: `Task "${taskId}" not found` };
            }
            // Use fix_project with existing task ID — handles SDK execution, log streaming, status updates
            // Pass _cwd to ensure SDK reads/writes the same tasks.json the kanban uses (process.cwd()),
            // not workspace.get() which may point to a different directory.
            const result = await fixProject.fix_project({
                description: task.description,
                target: 'workspace',
                _taskId: taskId, // Reuse existing kanban task instead of creating a new one
                _cwd: process.cwd(),
            });
            return result;
        }
        catch (err) {
            return { ok: false, result: `Error running task: ${err.message}` };
        }
    });
    // Remove completed tasks
    electron_1.ipcMain.handle('remove-completed-tasks', () => {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        try {
            if (!fs_1.default.existsSync(tasksPath)) {
                return { ok: true, removed: 0 };
            }
            const data = taskState.loadTasksFile(tasksPath, { cwd: process.cwd() });
            const tasks = data.tasks;
            // Keep only non-DONE tasks
            const remaining = tasks.filter((t) => !['completed', 'done'].includes(String(t.status || '').toLowerCase()));
            const removed = tasks.length - remaining.length;
            taskState.writeTasksFile(tasksPath, { ...data, tasks: remaining });
            log.info('Kanban', `Removed ${removed} completed tasks`);
            return { ok: true, removed };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    // Resize kanban window (width + optional height)
    electron_1.ipcMain.handle(ch.RESIZE_KANBAN, (_, width, height) => {
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
    electron_1.ipcMain.handle('set-kanban-visible', (_, visible) => {
        const win = kanbanWindow.get();
        if (win && !win.isDestroyed()) {
            if (visible)
                win.showInactive();
            else
                win.hide();
            return { ok: true };
        }
        return { ok: false };
    });
    // Git operations
    electron_1.ipcMain.handle('git-commit', async (_, message) => {
        const cwd = process.cwd();
        const commitMessage = message?.trim() || 'Update tasks';
        try {
            const pathsToStage = getKanbanPathsToStage(cwd);
            if (pathsToStage.length === 0) {
                return { ok: false, error: 'No kanban files available to commit' };
            }
            runGit(['add', '-A', '--', ...pathsToStage], cwd);
            const stagedFiles = runGit(['diff', '--cached', '--name-only', '--', ...pathsToStage], cwd)
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            if (stagedFiles.length === 0) {
                return { ok: false, error: 'No kanban changes to commit' };
            }
            runGit(['commit', '-m', commitMessage], cwd);
            log.info('Kanban', 'Git commit successful');
            return { ok: true, files: stagedFiles };
        }
        catch (err) {
            const errorMessage = getGitErrorMessage(err);
            log.warn('Kanban', `Git commit failed: ${errorMessage}`);
            return { ok: false, error: errorMessage };
        }
    });
    electron_1.ipcMain.handle('git-push', async () => {
        try {
            runGit(['push'], process.cwd());
            log.info('Kanban', 'Git push successful');
            return { ok: true };
        }
        catch (err) {
            const errorMessage = getGitErrorMessage(err);
            log.warn('Kanban', `Git push failed: ${errorMessage}`);
            return { ok: false, error: errorMessage };
        }
    });
    // Sync tasks to Convex
    electron_1.ipcMain.handle('sync-tasks-to-convex', async (_, tasks) => {
        try {
            // Store tasks in Convex for history/audit trail
            // This is one-way sync: kanban → Convex
            for (const task of tasks) {
                await convexStore.saveTurn('system', `Task: ${task.id} - ${task.title} (${task.status})`);
            }
            log.info('Kanban', `Synced ${tasks.length} tasks to Convex`);
            return { ok: true };
        }
        catch (err) {
            log.warn('Kanban', `Convex sync failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Update task logs
    electron_1.ipcMain.handle('update-task-logs', async (_, taskId, logs) => {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        try {
            if (!fs_1.default.existsSync(tasksPath)) {
                return { ok: false, error: 'Tasks file not found' };
            }
            const data = taskState.loadTasksFile(tasksPath, { cwd: process.cwd() });
            const tasks = data.tasks;
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                task.logs = logs;
                taskState.writeTasksFile(tasksPath, data);
                log.info('Kanban', `Updated logs for task ${taskId}`);
                return { ok: true };
            }
            return { ok: false, error: 'Task not found' };
        }
        catch (err) {
            log.error('Kanban', `Failed to update task logs: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('delete-kanban-task', async (_, taskId, source) => {
        try {
            await getCatalogService().deleteTask(taskId, source);
            return { ok: true };
        }
        catch (err) {
            log.error('Kanban', `Failed to delete task ${taskId}: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('add-kanban-task', async (_, task) => {
        try {
            await getCatalogService().saveTask(task);
            return { ok: true };
        }
        catch (err) {
            log.error('Kanban', `Failed to add task: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Check if spec.md exists
    electron_1.ipcMain.handle('spec-md-exists', () => {
        const specPath = path_1.default.join(process.cwd(), 'spec.md');
        return { exists: fs_1.default.existsSync(specPath) };
    });
    electron_1.ipcMain.handle('tasks-file-exists', () => {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        return { exists: fs_1.default.existsSync(tasksPath) };
    });
    // Write spec.md from aggregated tasks
    electron_1.ipcMain.handle('write-spec-md', async (_, spec) => {
        const specPath = path_1.default.join(process.cwd(), 'spec.md');
        try {
            fs_1.default.writeFileSync(specPath, spec, 'utf8');
            log.info('Kanban', 'Wrote spec.md');
            return { ok: true };
        }
        catch (err) {
            log.error('Kanban', `Failed to write spec.md: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Delete tasks.json file
    electron_1.ipcMain.handle('delete-tasks-file', async () => {
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        try {
            if (fs_1.default.existsSync(tasksPath)) {
                fs_1.default.unlinkSync(tasksPath);
                log.info('Kanban', 'Deleted tasks.json');
            }
            return { ok: true };
        }
        catch (err) {
            log.error('Kanban', `Failed to delete tasks.json: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Import log files into Convex database
    electron_1.ipcMain.handle(ch.IMPORT_LOGS, async (_, filePaths) => {
        let imported = 0;
        const errors = [];
        for (const filePath of filePaths) {
            try {
                if (!fs_1.default.existsSync(filePath)) {
                    errors.push(`${filePath}: not found`);
                    continue;
                }
                const content = fs_1.default.readFileSync(filePath, 'utf-8');
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
                    }
                    else if (line.length > 10) {
                        // Unstructured line — save as system context
                        await convexStore.saveTurn('iris', line.trim());
                        imported++;
                    }
                }
                log.info('Import', `Imported ${lines.length} lines from ${filePath}`);
            }
            catch (err) {
                errors.push(`${filePath}: ${err.message}`);
            }
        }
        return { ok: errors.length === 0, imported, errors };
    });
    // Parse spec.md and recreate tasks.json
    electron_1.ipcMain.handle('parse-spec-md', async () => {
        const specPath = path_1.default.join(process.cwd(), 'spec.md');
        const tasksPath = path_1.default.join(process.cwd(), 'tasks.json');
        log.info('Kanban', `[parse-spec-md] Starting parse, spec path: ${specPath}`);
        try {
            if (!fs_1.default.existsSync(specPath)) {
                log.warn('Kanban', `[parse-spec-md] spec.md not found at ${specPath}`);
                return { ok: false, error: 'spec.md not found' };
            }
            const spec = fs_1.default.readFileSync(specPath, 'utf8');
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
                            status: 'queued',
                            order: taskId,
                            files: [],
                            action: '',
                            verify: '',
                            done: '',
                            dependsOn: [],
                            dependencies: [],
                            inferredDependencies: [],
                            dependencyState: 'ready',
                            origin: 'kanban:spec',
                            launchMode: 'manual',
                            resumable: true,
                            resumeCount: 0,
                            startedAt: null,
                            projectPath: process.cwd(),
                            schedulerSource: 'tasks.json',
                            prompt: null,
                            blockedBy: [],
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });
                        taskId++;
                    }
                }
                else {
                    i++;
                }
            }
            log.info('Kanban', `[parse-spec-md] Parsed ${tasks.length} tasks from spec.md`);
            // Write tasks.json
            taskState.writeTasksFile(tasksPath, {
                version: 1,
                tasks,
            });
            log.info('Kanban', `[parse-spec-md] Wrote ${tasks.length} tasks to ${tasksPath}`);
            return { ok: true, count: tasks.length };
        }
        catch (err) {
            log.error('Kanban', `[parse-spec-md] Failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
}
