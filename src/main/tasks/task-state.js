const fs = require('node:fs');

const STATUS = {
	DRAFT: 'draft',
	QUEUED: 'queued',
	BLOCKED: 'blocked',
	RUNNING: 'running',
	RESUMING: 'resuming',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled',
};

const LEGACY_STATUS_MAP = {
	TODO: STATUS.QUEUED,
	PENDING: STATUS.QUEUED,
	IN_PROGRESS: STATUS.RUNNING,
	DONE: STATUS.COMPLETED,
	COMPLETED: STATUS.COMPLETED,
	FAILED: STATUS.FAILED,
	CANCELLED: STATUS.CANCELLED,
	DRAFT: STATUS.DRAFT,
	QUEUED: STATUS.QUEUED,
	BLOCKED: STATUS.BLOCKED,
	RUNNING: STATUS.RUNNING,
	RESUMING: STATUS.RESUMING,
};

function nowIso() {
	return new Date().toISOString();
}

function normalizeTaskStatus(status) {
	const key = String(status || '').trim().toUpperCase();
	return LEGACY_STATUS_MAP[key] || STATUS.QUEUED;
}

function normalizeTaskRecord(task = {}, { cwd = null } = {}) {
	const normalizedStatus = normalizeTaskStatus(task.status);
	const dependencies = Array.isArray(task.dependencies)
		? task.dependencies.filter(Boolean)
		: Array.isArray(task.dependsOn)
			? task.dependsOn.filter(Boolean)
			: [];
	const inferredDependencies = Array.isArray(task.inferredDependencies)
		? task.inferredDependencies.filter(Boolean)
		: [];
	return {
		...task,
		status: normalizedStatus,
		order: Number.isFinite(task.order) ? task.order : 0,
		files: Array.isArray(task.files) ? task.files : [],
		action: task.action || '',
		verify: task.verify || '',
		done: task.done || '',
		logs: task.logs || '',
		dependsOn: dependencies,
		dependencies,
		inferredDependencies,
		dependencyState: task.dependencyState || 'ready',
		origin: task.origin || 'kanban',
		launchMode: task.launchMode || 'manual',
		resumable: task.resumable !== false,
		resumeCount: Number.isFinite(task.resumeCount) ? task.resumeCount : 0,
		startedAt: task.startedAt || null,
		projectPath: task.projectPath || cwd || null,
		schedulerSource: task.schedulerSource || 'tasks.json',
		prompt: task.prompt || null,
		blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.filter(Boolean) : [],
		createdAt: task.createdAt || nowIso(),
		updatedAt: task.updatedAt || nowIso(),
	};
}

function loadTasksFile(tasksPath, { cwd = null } = {}) {
	if (!fs.existsSync(tasksPath)) {
		return { version: 1, updatedAt: nowIso(), tasks: [] };
	}
	const parsed = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : Array.isArray(parsed) ? parsed : [];
	return {
		version: parsed?.version || 1,
		updatedAt: parsed?.updatedAt || nowIso(),
		tasks: tasks.map((task) => normalizeTaskRecord(task, { cwd })),
	};
}

function writeTasksFile(tasksPath, data) {
	const next = {
		version: data?.version || 1,
		updatedAt: nowIso(),
		tasks: Array.isArray(data?.tasks) ? data.tasks : [],
	};
	fs.writeFileSync(tasksPath, JSON.stringify(next, null, 2), 'utf8');
	return next;
}

module.exports = {
	STATUS,
	loadTasksFile,
	normalizeTaskRecord,
	normalizeTaskStatus,
	writeTasksFile,
};
