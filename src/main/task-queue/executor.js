const log = require('../logger');
const { startCodingTask } = require('../coding/runner');

/**
 * Strategy 10: Sub-agent Orchestration
 * Splits a task into specialized sub-agents (Memory, Safety, Research, Skill)
 * and executes them in parallel or sequence based on dependency.
 */
async function executeStrategy10(taskId, prompt, projectPath, onLog) {
	log.info('TaskQueue', `Starting Strategy 10 execution for ${taskId}`);

	// Strategy 10 uses a hierarchy of specialized agents to ensure stability and correctness.
	const profiles = [
		{ id: 'memory', profile: 'memory-architect', count: 2 },
		{ id: 'safety', profile: 'safety-guardian', count: 2 },
		{ id: 'research', profile: 'observability-researcher', count: 3 },
		{ id: 'skill', profile: 'workflow-generalist', count: 3 }
	];

	const strategyPrompt = `
STABILIZATION STRATEGY CONTEXT:
${prompt}

SUB-AGENT ROLE:
You are one of 10 specialized agents working in parallel to implement the project stabilization strategy.
Your mission is to execute your assigned domain's contribution to the strategy while ensuring no regressions.
Domain assignments:
- Memory Architects: Focus on PRIORITY 6 (Persistence Convergence) and PRIORITY 2 (Task Authority).
- Safety Guardians: Focus on PRIORITY 5 (Preload/IPC Hardening) and PRIORITY 4 (UITaskService Split).
- Observability Researchers: Focus on PRIORITY 7 (Architecture Truth) and overall verification.
- Workflow Generalists: Focus on PRIORITY 1 (Bootstrap Slimming) and PRIORITY 3 (Global Authority removal).

INSTRUCTIONS:
1. Work within your assigned priority area.
2. Coordinate via the shared project files (CLAUDE.md, tasks.json).
3. Do not overwrite other agents' work without verification.
4. Run full verification after every change.
`;

	if (onLog) onLog('[Strategy 10] Orchestrating 10 specialized sub-agents...');

	const subAgents = [];
	for (const p of profiles) {
		for (let i = 0; i < p.count; i++) {
			subAgents.push({
				id: `${taskId}-${p.id}-${i}`,
				profile: p.profile,
				prompt: `[Sub-agent: ${p.id}-${i}] ${strategyPrompt}`
			});
		}
	}

	// Execute sub-agents
	const results = await Promise.all(subAgents.map(async (agent) => {
		if (onLog) onLog(`[Strategy 10] Launching ${agent.id} (${agent.profile})...`);
		const handle = startCodingTask({
			taskId: agent.id,
			prompt: agent.prompt,
			cwd: projectPath,
			hireableProfile: agent.profile,
			onLog: (line) => {
				if (onLog) onLog(`[${agent.id}] ${line.substring(0, 50)}...`);
			}
		});
		return handle.completion;
	}));

	const successful = results.filter(r => r && (r.status === 'COMPLETED' || r.status === 'done'));
	if (onLog) onLog(`[Strategy 10] ${successful.length}/10 sub-agents reported success.`);

	return {
		status: successful.length > 0 ? 'COMPLETED' : 'FAILED',
		summary: `Strategy 10 Execution Summary:\n- Total Sub-agents: 10\n- Success: ${successful.length}\n- Domains: Memory, Safety, Research, Skill\n- Focus: Project Stabilization Strategy`
	};
}

async function executeTask(taskId, prompt, projectPath, onLog, strategy = 'watcher-executor') {
	log.info('TaskQueue', `Starting execution for ${taskId} in ${projectPath} (Strategy: ${strategy})`);

	if (strategy === 'strategy_10') {
		return executeStrategy10(taskId, prompt, projectPath, onLog);
	}

	const handle = startCodingTask({
		taskId,
		prompt,
		cwd: projectPath,
		onLog: (line) => {
			if (onLog) onLog(line);
		},
	});
	return handle.completion;
}

module.exports = { executeTask };
