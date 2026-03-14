const { TaskRepository } = require('./task-repository.js');

/**
 * @extends TaskRepository
 */
class QueueTaskRepository extends TaskRepository {
	/**
	 * @param {Object} convexClient - The Convex client instance
	 * @param {Object} [options]
	 * @param {string} [options.projectPath] - Optional project path filter
	 */
	constructor(convexClient, options = {}) {
		super();
		this.convexClient = convexClient;
		this.projectPath = options.projectPath;
	}

	/**
	 * @private
	 * @param {Object} convexTask
	 * @returns {import('./task-repository').TaskRecord}
	 */
	_normalize(convexTask) {
		return {
			id: convexTask._id,
			title: convexTask.intake?.summary || convexTask.rawPrompt?.slice(0, 100) || 'Untitled Task',
			description: convexTask.rawPrompt,
			status: convexTask.status,
			order: convexTask.order || 0,
			files: convexTask.impactedFiles || [],
			action: '',
			verify: '',
			done: convexTask.result || '',
			logs: convexTask.errorMessage || '',
			dependsOn: convexTask.dependencies || [],
			dependencyState: convexTask.dependencyState || 'ready',
			origin: convexTask.origin || 'convex',
			launchMode: convexTask.launchMode || 'manual',
			resumable: convexTask.resumable !== false,
			resumeCount: convexTask.resumeCount || 0,
			startedAt: convexTask.startedAt ? new Date(convexTask.startedAt).toISOString() : null,
			projectPath: convexTask.projectPath,
			schedulerSource: 'convex',
			prompt: convexTask.enrichedPrompt || convexTask.rawPrompt,
			blockedBy: convexTask.blockedBy || [],
			createdAt: new Date(convexTask.createdAt).toISOString(),
			updatedAt: new Date(convexTask.updatedAt).toISOString(),
		};
	}

	async getTasks() {
		let result;
		if (this.projectPath) {
			result = await this.convexClient.getQueueTasksByProject(this.projectPath);
		} else {
			result = await this.convexClient.getAllQueueTasks();
		}

		if (!result.ok) throw new Error(`Convex error: ${result.error}`);
		return (result.value || []).map((t) => this._normalize(t));
	}

	async getTaskById(id) {
		// ConvexClient doesn't have getTaskById, but we can use getAll and find or add it if needed.
		// For now, let's use the list and find.
		const tasks = await this.getTasks();
		return tasks.find((t) => t.id === id) || null;
	}

	async saveTask(task) {
		const isNew = !task.id || !task.id.match(/^[0-9a-z]+$/i); // Simple check for Convex ID

		const convexTask = {
			projectPath: task.projectPath,
			rawPrompt: task.description || task.title,
			enrichedPrompt: task.prompt,
			impactedFiles: task.files,
			status: task.status,
			origin: task.origin,
			launchMode: task.launchMode,
			resumable: task.resumable,
			resumeCount: task.resumeCount,
			dependencyState: task.dependencyState,
			dependencies: task.dependsOn,
			blockedBy: task.blockedBy,
			updatedAt: Date.now(),
		};

		if (isNew) {
			convexTask.createdAt = Date.now();
			const result = await this.convexClient.createQueueTask(convexTask);
			if (!result.ok) throw new Error(`Convex error: ${result.error}`);
			task.id = result.value;
		} else {
			const result = await this.convexClient.updateQueueTask(task.id, convexTask);
			if (!result.ok) throw new Error(`Convex error: ${result.error}`);
		}
	}

	async deleteTask(id) {
		const result = await this.convexClient.updateQueueTask(id, {
			status: 'cancelled',
			errorMessage: 'Dismissed by user',
			updatedAt: Date.now(),
		});
		if (!result.ok) throw new Error(`Convex error: ${result.error}`);
	}
}

module.exports = { QueueTaskRepository };
