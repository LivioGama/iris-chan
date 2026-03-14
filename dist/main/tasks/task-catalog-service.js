"use strict";
const { normalizeTaskStatus } = require('./task-state');
/**
 * @typedef {import('./repositories/task-repository').TaskRecord} TaskRecord
 */
/**
 * TaskCatalogService provides a unified view of tasks from multiple sources.
 * It reconciles local file-based tasks and remote queue-based tasks.
 */
class TaskCatalogService {
    /**
     * @param {Object} options
     * @param {import('./repositories/file-task-repository').FileTaskRepository} options.fileRepo
     * @param {import('./repositories/queue-task-repository').QueueTaskRepository} options.queueRepo
     * @param {import('../windows/kanban-window')} [options.kanbanWindow]
     */
    constructor({ fileRepo, queueRepo, kanbanWindow }) {
        this.fileRepo = fileRepo;
        this.queueRepo = queueRepo;
        this.kanbanWindow = kanbanWindow;
    }
    /**
     * Returns a reconciled list of all tasks from both repositories.
     * @returns {Promise<TaskRecord[]>}
     */
    async getAllTasks() {
        const [fileTasks, queueTasks] = await Promise.all([
            this.fileRepo.getTasks().catch((err) => {
                console.error('Failed to fetch file tasks:', err);
                return [];
            }),
            this.queueRepo.getTasks().catch((err) => {
                console.error('Failed to fetch queue tasks:', err);
                return [];
            }),
        ]);
        const normalizedFileTasks = fileTasks.map((t) => ({
            ...t,
            source: 'file',
            normalizedStatus: normalizeTaskStatus(t.status),
        }));
        const reconciledTasks = [...normalizedFileTasks];
        for (const q of queueTasks) {
            const existingIndex = reconciledTasks.findIndex(t => t.id === q.id ||
                (t.title === q.title && t.description === q.description));
            const normalizedQ = {
                ...q,
                source: 'queue',
                normalizedStatus: normalizeTaskStatus(q.status),
            };
            if (existingIndex >= 0) {
                // Reconcile: Prefer queue data for status/logs if more recent or active
                reconciledTasks[existingIndex] = {
                    ...reconciledTasks[existingIndex],
                    ...normalizedQ,
                    // Keep file-based ID if it was matched by content
                    id: reconciledTasks[existingIndex].id,
                    queueTaskId: q.id,
                };
            }
            else {
                reconciledTasks.push(normalizedQ);
            }
        }
        return reconciledTasks.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });
    }
    /**
     * Broadcasts a task update to the renderer.
     * @param {Object} update
     */
    broadcastUpdate(update) {
        const win = this.kanbanWindow?.get();
        if (win && !win.isDestroyed()) {
            win.webContents.send('tasks-reconciled-update', update);
        }
    }
    /**
     * Gets a single task by ID searching through both repositories.
     * @param {string} id
     * @returns {Promise<TaskRecord|null>}
     */
    async getTaskById(id) {
        // Attempt to find in file repo first (likely faster/local)
        let task = await this.fileRepo.getTaskById(id);
        if (task)
            return { ...task, source: 'file' };
        // Fallback to queue repo
        task = await this.queueRepo.getTaskById(id);
        if (task)
            return { ...task, source: 'queue' };
        return null;
    }
    /**
     * Saves a task to the appropriate repository based on its source or provided preference.
     * @param {TaskRecord} task
     * @param {'file'|'queue'} [preferredSource]
     */
    async saveTask(task, preferredSource) {
        const source = preferredSource || task.source || 'file';
        if (source === 'queue') {
            await this.queueRepo.saveTask(task);
        }
        else {
            await this.fileRepo.saveTask(task);
        }
    }
    /**
     * Deletes a task from the appropriate repository.
     * @param {string} id
     * @param {'file'|'queue'} [source] - If not provided, attempts to find where it exists.
     */
    async deleteTask(id, source) {
        if (source === 'file') {
            await this.fileRepo.deleteTask(id);
            return;
        }
        if (source === 'queue') {
            await this.queueRepo.deleteTask(id);
            return;
        }
        // Auto-detect
        const task = await this.getTaskById(id);
        if (!task)
            return;
        if (task.source === 'file') {
            await this.fileRepo.deleteTask(id);
        }
        else {
            await this.queueRepo.deleteTask(id);
        }
    }
}
module.exports = { TaskCatalogService };
