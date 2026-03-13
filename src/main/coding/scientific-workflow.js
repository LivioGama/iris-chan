function normalizeTaskText(value) {
	return String(value || '').replace(/\r\n/g, '\n').trim();
}

function deriveObjective(description) {
	const normalized = normalizeTaskText(description);
	if (!normalized) return 'Complete the requested change and verify the result.';
	const firstLine = normalized.split('\n').find(Boolean) || normalized;
	return firstLine.slice(0, 160);
}

function deriveTargetProject(name, args = {}) {
	if (args.target) return String(args.target);
	if (name === 'self_fix') return 'iris';
	return 'workspace';
}

function buildScientificMethodGuide() {
	return [
		'AI Scientist workflow:',
		'1. Form a concrete hypothesis from existing evidence before editing.',
		'2. Design the smallest decisive experiment or code change that tests that hypothesis.',
		'3. Explore meaningful configuration and hyper-parameter tradeoffs instead of trying one arbitrary value.',
		'4. Run empirical verification after each meaningful change and use the observed output as the next input.',
		'5. End with a brief self-review covering correctness, regressions, reproducibility, and remaining risks.',
		'Reproducibility requirements: capture environment assumptions, prefer scripted verification, note version-control state, and consider container/dev-server/restart implications when they affect results.',
		'Research style: merge local code evidence with interdisciplinary search only when needed, stay compute-efficient, and avoid speculative claims that are not backed by logs or artifacts.',
	].join('\n');
}

function buildScientificTaskMetadata({ description, target = 'workspace', projectPath = null } = {}) {
	const objective = deriveObjective(description);
	return {
		workflow: 'ai_scientist_v1',
		workflowStage: 'hypothesis',
		objective,
		target,
		projectPath: projectPath || null,
		hypotheses: [
			'Identify the highest-probability root cause or leverage point from repository evidence before changing code.',
			'Prefer the smallest change that can be proven with strong verification over broad speculative edits.',
		],
		experimentPlan: [
			'Inspect the most relevant implementation and tests first.',
			'Implement one decisive fix or improvement step.',
			'Run the strongest available verification and inspect real output/logs.',
		],
		explorationPlan: [
			'Check for relevant configuration, parameter, or prompt tradeoffs instead of assuming current defaults are optimal.',
			'Record any remaining candidate follow-ups if they are not justified by current evidence.',
		],
		reportingPlan: [
			'Summarize completed work, current evidence, next step, and blockers concisely.',
			'Include restart, containerization, and version-control considerations when they materially affect reproducibility.',
		],
		reproducibility: {
			recordWorkspaceState: true,
			recordVerificationEvidence: true,
			considerContainerization: true,
			considerVersionControl: true,
			considerRestartRequirements: true,
		},
	};
}

function applyScientificWorkflowDefaults(name, args = {}) {
	if (!['fix_project', 'add_task', 'self_fix'].includes(name)) {
		return args || {};
	}
	const nextArgs = { ...(args || {}) };
	const description = normalizeTaskText(nextArgs.description);
	if (description) nextArgs.description = description;
	nextArgs.target = deriveTargetProject(name, nextArgs);
	nextArgs.scientific_workflow = nextArgs.scientific_workflow || 'ai_scientist_v1';
	nextArgs.autonomous_execution = nextArgs.autonomous_execution !== false;
	nextArgs.auto_verify = nextArgs.auto_verify !== false;
	nextArgs.self_review = nextArgs.self_review !== false;
	nextArgs.consider_reproducibility = nextArgs.consider_reproducibility !== false;
	nextArgs.consider_containerization = nextArgs.consider_containerization !== false;
	nextArgs.consider_version_control = nextArgs.consider_version_control !== false;
	nextArgs.scientific_metadata = nextArgs.scientific_metadata || buildScientificTaskMetadata({
		description,
		target: nextArgs.target,
		projectPath: nextArgs.project_path || nextArgs._cwd || null,
	});
	return nextArgs;
}

module.exports = {
	applyScientificWorkflowDefaults,
	buildScientificMethodGuide,
	buildScientificTaskMetadata,
	deriveObjective,
	normalizeTaskText,
};
