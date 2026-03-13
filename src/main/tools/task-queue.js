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

module.exports = { add_task, setConvexClient };
