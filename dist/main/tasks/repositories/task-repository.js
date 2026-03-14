"use strict";
/**
 * @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {'draft'|'queued'|'blocked'|'running'|'resuming'|'completed'|'failed'|'cancelled'} status
 * @property {number} order
 * @property {string[]} files
 * @property {string} action
 * @property {string} verify
 * @property {string} done
 * @property {string} logs
 * @property {string[]} dependsOn
 * @property {string} dependencyState
 * @property {string} origin
 * @property {string} launchMode
 * @property {boolean} resumable
 * @property {number} resumeCount
 * @property {string|null} startedAt
 * @property {string|null} projectPath
 * @property {string} schedulerSource
 * @property {string|null} prompt
 * @property {string[]} blockedBy
 * @property {string} createdAt
 * @property {string} updatedAt
 */
/**
 * @interface TaskRepository
 */
class TaskRepository {
    /**
     * @returns {Promise<TaskRecord[]>}
     */
    async getTasks() {
        throw new Error('Not implemented');
    }
    /**
     * @param {string} id
     * @returns {Promise<TaskRecord|null>}
     */
    async getTaskById(id) {
        throw new Error('Not implemented');
    }
    /**
     * @param {TaskRecord} task
     * @returns {Promise<void>}
     */
    async saveTask(task) {
        throw new Error('Not implemented');
    }
    /**
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteTask(id) {
        throw new Error('Not implemented');
    }
}
module.exports = { TaskRepository };
