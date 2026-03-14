"use strict";
const { TaskRepository } = require('./task-repository.js');
const { loadTasksFile, writeTasksFile, normalizeTaskRecord } = require('../task-state.js');
/**
 * @extends TaskRepository
 */
class FileTaskRepository extends TaskRepository {
    /**
     * @param {string} filePath - Absolute path to tasks.json
     * @param {Object} [options]
     * @param {string} [options.cwd]
     */
    constructor(filePath, options = {}) {
        super();
        this.filePath = filePath;
        this.cwd = options.cwd;
    }
    async getTasks() {
        const { tasks } = loadTasksFile(this.filePath, { cwd: this.cwd });
        return tasks;
    }
    async getTaskById(id) {
        const tasks = await this.getTasks();
        return tasks.find((t) => t.id === id) || null;
    }
    async saveTask(task) {
        const data = loadTasksFile(this.filePath, { cwd: this.cwd });
        const normalized = normalizeTaskRecord(task, { cwd: this.cwd });
        const idx = data.tasks.findIndex((t) => t.id === normalized.id);
        if (idx >= 0) {
            data.tasks[idx] = normalized;
        }
        else {
            data.tasks.push(normalized);
        }
        writeTasksFile(this.filePath, data);
    }
    async deleteTask(id) {
        const data = loadTasksFile(this.filePath, { cwd: this.cwd });
        const initialCount = data.tasks.length;
        data.tasks = data.tasks.filter((t) => t.id !== id);
        if (data.tasks.length !== initialCount) {
            writeTasksFile(this.filePath, data);
        }
    }
}
module.exports = { FileTaskRepository };
