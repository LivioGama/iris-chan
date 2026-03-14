const log = require('../logger');
const workspace = require('../workspace');
const { buildScientificTaskMetadata, normalizeTaskText } = require('../coding/scientific-workflow');
const taskQueueService = require('../task-queue/service');

function setConvexClient(client) {
	taskQueueService.setConvexClient(client);
}

async function add_task(args) {
	const description = normalizeTaskText(args.description);
	if (!description) return { ok: false, result: 'No task description provided' };

	const projectPath = args.project_path || null;

	try {
		const { detectHoveredPath } = require('../task-queue/path-detector');
		if (!taskQueueService.getConvexClient()) {
			return { ok: false, result: 'Task queue not initialized (Convex client unavailable)' };
		}

		const scientificMetadata = args.scientific_metadata || buildScientificTaskMetadata({
			description,
			target: args.target || 'workspace',
			projectPath: projectPath || workspace.get() || null,
		});
		const created = await taskQueueService.createQueuedTask({
			rawPrompt: description,
			projectPath,
			origin: 'tool:add_task',
			strategy: args.strategy,
			executionLane: args.execution_lane || args.executionLane,
			hireableProfile: args.hireable_profile || args.hireableProfile,
			queueBucket: args.queue_bucket || args.queueBucket,
			dependencies: args.dependencies,
			countdownSeconds: args._countdownSeconds,
			countdownTickMs: args._countdownTickMs,
			resolveProjectPath: async () => {
				const workspacePath = workspace.get();
				if (workspacePath) return workspacePath;
				const detection = await detectHoveredPath();
				if (detection.ok) return detection.projectPath;
				throw new Error(`Could not detect project: ${detection.error}. Hover over a project or specify project_path.`);
			},
		});

		const projectName = created.projectPath.split('/').pop();
		return {
			ok: true,
			taskId: created.taskId,
			projectPath: created.projectPath,
			result: `✓ Task queued for ${projectName}: "${description}"\nWorkflow: hypothesis -> experiment -> verify -> self-review.\nWill be enriched and auto-approved in 10s.`,
		};
	} catch (err) {
		log.error('TaskQueue', `add_task error: ${err.message}`);
		return { ok: false, result: `Error: ${err.message}` };
	}
}

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

async function extract_tasks(args) {
	const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
	if (!tasks.length) return { ok: false, result: 'No tasks provided' };

	if (!taskQueueService.getConvexClient()) {
		return { ok: false, result: 'Task queue not initialized (Convex client unavailable)' };
	}

	const results = [];
	for (const task of tasks) {
		const title = normalizeTaskText(task.title);
		const description = normalizeTaskText(task.description);
		if (!title && !description) continue;

		const priority = VALID_PRIORITIES.has(task.priority) ? task.priority : 'medium';
		const rawPrompt = title
			? `[${priority.toUpperCase()}] ${title}\n\n${description}`
			: `[${priority.toUpperCase()}] ${description}`;

		try {
			const created = await taskQueueService.createQueuedTask({
				rawPrompt,
				projectPath: task.project_path || null,
				origin: 'voice-extraction',
				executionLane: task.execution_lane,
				dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
				intake: {
					source: 'voice',
					mode: 'passive-extraction',
					summary: title || description.slice(0, 120),
					capturedAt: Date.now(),
				},
				resolveProjectPath: async () => {
					const workspacePath = workspace.get();
					if (workspacePath) return workspacePath;
					throw new Error('No project path and no workspace set');
				},
			});
			results.push({ title: title || description.slice(0, 60), taskId: created.taskId, ok: true });
		} catch (err) {
			log.warn('TaskQueue', `extract_tasks: failed to create "${title}": ${err.message}`);
			results.push({ title: title || description.slice(0, 60), ok: false, error: err.message });
		}
	}

	const successCount = results.filter(r => r.ok).length;
	log.info('TaskQueue', `extract_tasks: created ${successCount}/${tasks.length} tasks`);
	return {
		ok: successCount > 0,
		result: `Extracted ${successCount}/${tasks.length} tasks.`,
		tasks: results,
	};
}

module.exports = { add_task, extract_tasks, setConvexClient };
