import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as kanbanWindow from '../windows/kanban-window';
import * as log from '../logger';
import * as convexStore from '../convex-store';
import * as skills from '../skills';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface Task {
    id: string;
    title: string;
    description: string;
    status: string;
    order: number;
    files: string[];
    action: string;
    verify: string;
    done: string;
    dependsOn: string[];
    createdAt: string;
    updatedAt: string;
    logs?: any;
}

export interface TasksData {
    version?: number;
    updatedAt?: string;
    tasks: Task[];
}

export function register() {
    // Kanban tasks
    ipcMain.handle(ch.LOAD_KANBAN_TASKS, () => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');

        try {
            if (!fs.existsSync(tasksPath)) {
                return [];
            }
            const content = fs.readFileSync(tasksPath, 'utf8');
            const data = JSON.parse(content);
            // Extract tasks array from the JSON structure
            return (data.tasks || data) || [];
        } catch (err: any) {
            log.error('Kanban', `Failed to load tasks.json: ${err.message}`);
            return [];
        }
    });

    ipcMain.handle(ch.SAVE_KANBAN_TASKS, (_, tasks: Task[]) => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');

        try {
            const data: TasksData = {
                version: 1,
                updatedAt: new Date().toISOString(),
                tasks: tasks
            };
            fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
            log.info('Kanban', 'Tasks saved successfully');
            return { ok: true };
        } catch (err: any) {
            log.error('Kanban', `Failed to save tasks.json: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Run individual task via claude-code-assistant skill with streaming logs
    ipcMain.handle(ch.RUN_TASK, async (_, taskId: string) => {
        try {
            const tasksPath = path.join(process.cwd(), 'tasks.json');

            if (!fs.existsSync(tasksPath)) {
                return { ok: false, result: 'No tasks file found' };
            }

            const content = fs.readFileSync(tasksPath, 'utf8');
            const data = JSON.parse(content);
            const tasks = (data.tasks || data) as Task[];
            const task = tasks.find(t => t.id === taskId);

            if (!task) {
                return { ok: false, result: `Task "${taskId}" not found` };
            }

            // Set task to IN_PROGRESS immediately
            task.status = 'IN_PROGRESS';
            task.logs = '';
            task.updatedAt = new Date().toISOString();
            data.updatedAt = new Date().toISOString();
            fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');

            // Stream logs to task
            let logBuffer = '';
            let flushTimer: ReturnType<typeof setTimeout> | null = null;

            const flushLogs = () => {
                try {
                    const freshData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
                    const t = (freshData.tasks || []).find((t: Task) => t.id === taskId);
                    if (t) {
                        const lines = logBuffer.split('\n');
                        if (lines.length > 50) logBuffer = lines.slice(-50).join('\n');
                        t.logs = logBuffer;
                        t.updatedAt = new Date().toISOString();
                        freshData.updatedAt = new Date().toISOString();
                        fs.writeFileSync(tasksPath, JSON.stringify(freshData, null, 2), 'utf8');
                    }
                } catch {}
            };

            const onLog = (line: string) => {
                logBuffer += (logBuffer ? '\n' : '') + line;
                if (!flushTimer) {
                    flushTimer = setTimeout(() => {
                        flushTimer = null;
                        flushLogs();
                    }, 2000);
                }
            };

            // Run skill with streaming logs
            const result = await skills.runSkillByName('claude-code-assistant', { description: task.description }, onLog);

            // Final update: set status and flush logs
            if (flushTimer) clearTimeout(flushTimer);
            logBuffer += result.ok ? '\n✅ Completed successfully' : `\n❌ Failed: ${result.result || 'Unknown error'}`;

            try {
                const freshData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
                const t = (freshData.tasks || []).find((t: Task) => t.id === taskId);
                if (t) {
                    t.status = result.ok ? 'COMPLETED' : 'FAILED';
                    t.logs = logBuffer;
                    t.updatedAt = new Date().toISOString();
                    freshData.updatedAt = new Date().toISOString();
                    fs.writeFileSync(tasksPath, JSON.stringify(freshData, null, 2), 'utf8');
                }
            } catch {}

            return result;
        } catch (err: any) {
            return { ok: false, result: `Error running task: ${err.message}` };
        }
    });

    // Remove completed tasks
    ipcMain.handle('remove-completed-tasks', () => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');

        try {
            if (!fs.existsSync(tasksPath)) {
                return { ok: true, removed: 0 };
            }

            const content = fs.readFileSync(tasksPath, 'utf8');
            const data = JSON.parse(content);
            const tasks = (data.tasks || data) as Task[];

            // Keep only non-DONE tasks
            const remaining = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'DONE');
            const removed = tasks.length - remaining.length;

            data.tasks = remaining;
            data.updatedAt = new Date().toISOString();

            fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
            log.info('Kanban', `Removed ${removed} completed tasks`);

            return { ok: true, removed };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    });

    // Resize kanban window (width + optional height)
    ipcMain.handle(ch.RESIZE_KANBAN, (_, width: number, height?: number) => {
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
    ipcMain.handle('set-kanban-visible', (_, visible: boolean) => {
        const win = kanbanWindow.get();
        if (win && !win.isDestroyed()) {
            if (visible) win.show();
            else win.hide();
            return { ok: true };
        }
        return { ok: false };
    });

    // Git operations
    ipcMain.handle('git-commit', async (_, message: string) => {
        try {
            execSync('git add .', { cwd: process.cwd() });
            execSync(`git commit -m "${message || 'Update tasks'}"`, { cwd: process.cwd() });
            log.info('Kanban', 'Git commit successful');
            return { ok: true };
        } catch (err: any) {
            log.warn('Kanban', `Git commit failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('git-push', async () => {
        try {
            execSync('git push', { cwd: process.cwd() });
            log.info('Kanban', 'Git push successful');
            return { ok: true };
        } catch (err: any) {
            log.warn('Kanban', `Git push failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Sync tasks to Convex
    ipcMain.handle('sync-tasks-to-convex', async (_, tasks: Task[]) => {
        try {
            // Store tasks in Convex for history/audit trail
            // This is one-way sync: kanban → Convex
            for (const task of tasks) {
                await convexStore.saveTurn('system', `Task: ${task.id} - ${task.title} (${task.status})`);
            }
            log.info('Kanban', `Synced ${tasks.length} tasks to Convex`);
            return { ok: true };
        } catch (err: any) {
            log.warn('Kanban', `Convex sync failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Update task logs
    ipcMain.handle('update-task-logs', async (_, taskId: string, logs: any) => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');

        try {
            if (!fs.existsSync(tasksPath)) {
                return { ok: false, error: 'Tasks file not found' };
            }

            const content = fs.readFileSync(tasksPath, 'utf8');
            const data = JSON.parse(content);
            const tasks = (data.tasks || data) as Task[];
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
        } catch (err: any) {
            log.error('Kanban', `Failed to update task logs: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Check if spec.md exists
    ipcMain.handle('spec-md-exists', () => {
        const specPath = path.join(process.cwd(), 'spec.md');
        return { exists: fs.existsSync(specPath) };
    });

    ipcMain.handle('tasks-file-exists', () => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');
        return { exists: fs.existsSync(tasksPath) };
    });

    // Write spec.md from aggregated tasks
    ipcMain.handle('write-spec-md', async (_, spec: string) => {
        const specPath = path.join(process.cwd(), 'spec.md');

        try {
            fs.writeFileSync(specPath, spec, 'utf8');
            log.info('Kanban', 'Wrote spec.md');
            return { ok: true };
        } catch (err: any) {
            log.error('Kanban', `Failed to write spec.md: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Delete tasks.json file
    ipcMain.handle('delete-tasks-file', async () => {
        const tasksPath = path.join(process.cwd(), 'tasks.json');

        try {
            if (fs.existsSync(tasksPath)) {
                fs.unlinkSync(tasksPath);
                log.info('Kanban', 'Deleted tasks.json');
            }
            return { ok: true };
        } catch (err: any) {
            log.error('Kanban', `Failed to delete tasks.json: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });

    // Import log files into Convex database
    ipcMain.handle(ch.IMPORT_LOGS, async (_, filePaths: string[]) => {
        let imported = 0;
        const errors: string[] = [];

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
            } catch (err: any) {
                errors.push(`${filePath}: ${err.message}`);
            }
        }

        return { ok: errors.length === 0, imported, errors };
    });

    // Parse spec.md and recreate tasks.json
    ipcMain.handle('parse-spec-md', async () => {
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
            const tasks: Task[] = [];
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
                    const descriptionLines: string[] = [];
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
            const data: TasksData = {
                version: 1,
                updatedAt: new Date().toISOString(),
                tasks: tasks
            };
            fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
            log.info('Kanban', `[parse-spec-md] Wrote ${tasks.length} tasks to ${tasksPath}`);

            return { ok: true, count: tasks.length };
        } catch (err: any) {
            log.error('Kanban', `[parse-spec-md] Failed: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
}
