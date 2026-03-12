const log = require('../logger');
const workspace = require('../workspace');
const { buildScientificTaskMetadata, normalizeTaskText } = require('../coding/scientific-workflow');

let _convexClient = null;

function setConvexClient(client) {
	_convexClient = client;
}

async function add_task(args) {
	const description = normalizeTaskText(args.description);
	if (!description) return { ok: false, result: 'No task description provided' };

	const projectPath = args.project_path || null;

	try {
		const { detectHoveredPath } = require('../task-queue/path-detector');
		const { enrichPrompt } = require('../task-queue/enricher');

		let resolvedPath = projectPath || workspace.get();
		if (!resolvedPath) {
			const detection = await detectHoveredPath();
			if (detection.ok) {
				resolvedPath = detection.projectPath;
			} else {
				return { ok: false, result: `Could not detect project: ${detection.error}. Hover over a project or specify project_path.` };
			}
		}

		if (!_convexClient) {
			return { ok: false, result: 'Task queue not initialized (Convex client unavailable)' };
		}

		const scientificMetadata = args.scientific_metadata || buildScientificTaskMetadata({
			description,
			target: args.target || 'workspace',
			projectPath: resolvedPath,
		});
		const idempotencyKey = `tq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const result = await _convexClient.createQueueTask({
			projectPath: resolvedPath,
			rawPrompt: description,
			objective: scientificMetadata.objective,
			workflow: scientificMetadata.workflow,
			workflowStage: 'queued',
			scientificMetadata,
			autoVerify: args.auto_verify !== false,
			selfReview: args.self_review !== false,
			status: 'draft',
			origin: 'tool:add_task',
			launchMode: 'queued',
			resumable: true,
			resumeCount: 0,
			dependencyState: 'pending',
			dependencies: Array.isArray(args.dependencies) ? args.dependencies.filter(Boolean) : [],
			inferredDependencies: [],
			blockedBy: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}, idempotencyKey);

		if (!result.ok) {
			return { ok: false, result: `Failed to create task: ${result.error}` };
		}

		const taskId = result.value;

		// Enrich async
		enrichPrompt(description, resolvedPath).then(async (enriched) => {
			await _convexClient.updateQueueTask(taskId, {
				enrichedPrompt: enriched.enrichedPrompt,
				impactedFiles: enriched.impactedFiles,
				complexity: enriched.complexity,
				experimentPlan: enriched.experimentPlan || scientificMetadata.experimentPlan,
				explorationPlan: enriched.explorationPlan || scientificMetadata.explorationPlan,
				verificationPlan: enriched.verificationPlan || scientificMetadata.reportingPlan,
				workflowStage: 'ready',
				dependencyState: 'ready',
				updatedAt: Date.now(),
			});
		}).catch((err) => {
			log.warn('TaskQueue', `Enrichment failed: ${err.message}`);
		});

		// Auto-approve after 10s (only if still in draft state — don't resurrect cancelled tasks)
		setTimeout(async () => {
			try {
				// Check current status before approving — task may have been cancelled or already approved
				const allTasks = await _convexClient.getAllQueueTasks();
				const current = allTasks.ok && allTasks.value?.find(t => String(t._id) === String(taskId));
				if (current && current.status === 'draft') {
					await _convexClient.updateQueueTask(taskId, { status: 'queued', dependencyState: 'ready', updatedAt: Date.now() });
					log.info('TaskQueue', `Auto-approved task ${taskId}`);
				} else {
					log.info('TaskQueue', `Skipped auto-approve for ${taskId} (status: ${current?.status || 'not found'})`);
				}
			} catch (err) {
				log.warn('TaskQueue', `Auto-approve check failed for ${taskId}: ${err.message}`);
			}
		}, 10000);

		const projectName = resolvedPath.split('/').pop();
		return { ok: true, result: `✓ Task queued for ${projectName}: "${description}"\nWorkflow: hypothesis -> experiment -> verify -> self-review.\nWill be enriched and auto-approved in 10s.` };
	} catch (err) {
		log.error('TaskQueue', `add_task error: ${err.message}`);
		return { ok: false, result: `Error: ${err.message}` };
	}
}

module.exports = { add_task, setConvexClient };
