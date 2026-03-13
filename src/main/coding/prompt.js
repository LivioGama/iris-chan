const fs = require('node:fs');
const path = require('node:path');
const { getMemoryStore } = require('../automation/service-ref');
const { buildScientificMethodGuide } = require('./scientific-workflow');

function buildAutonomousPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.autonomous_self_drive', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned autonomy policy: ${message}`;
}

function buildProgressPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.progress_accountability', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned progress policy: ${message}`;
}

function buildExecutionPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.thorough_execution', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned execution policy: ${message}`;
}

function buildConflictResolutionPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.conflict_resolution_continuation', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned conflict-resolution policy: ${message}`;
}

function buildTerminalLogPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.terminal_log_observability', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned terminal-observability policy: ${message}`;
}

function buildTaskCreationPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.task_creation_accountability', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned task-history policy: ${message}`;
}

function buildDirectTaskCreationPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.direct_task_creation', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned task-creation policy: ${message}`;
}

function buildEditorGeneralizationPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.editor_self_improvement_generalization', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned editor-improvement policy: ${message}`;
}

function buildScreenReferencePolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.screen_reference_direct_action', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned screen-reference policy: ${message}`;
}

function buildActionVerificationPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.action_verification', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned action-verification policy: ${message}`;
}

function buildPreClickPreparationPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.pre_click_preparation', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned UI-preparation policy: ${message}`;
}

function buildPresencePolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.presence_reassurance', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned presence policy: ${message}`;
}

function buildDirectCreativeFulfillmentPolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.direct_creative_fulfillment', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned direct-creative policy: ${message}`;
}

function buildPositiveFeedbackClosurePolicyNote() {
	const policy = getMemoryStore()?.getValue?.('policy.positive_feedback_closure', null);
	const message = String(policy?.message || '').trim();
	if (!message) return '';
	return `Learned positive-feedback policy: ${message}`;
}

function buildCodingPrompt({ description, cwd, target = null } = {}) {
	let context = '';
	const claudeMdPath = path.join(cwd, 'CLAUDE.md');
	if (fs.existsSync(claudeMdPath)) {
		try {
			context += `Project instructions (CLAUDE.md):\n${fs.readFileSync(claudeMdPath, 'utf8').substring(0, 3000)}\n\n`;
		} catch {}
	}

	const pkgPath = path.join(cwd, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			context += `Project: ${pkg.name || 'unknown'} — ${pkg.description || ''}\n\n`;
		} catch {}
	}

	return [
		`Working directory: ${cwd}`,
		target ? `Target: ${target}` : '',
		context.trimEnd(),
		buildAutonomousPolicyNote(),
		buildProgressPolicyNote(),
		buildExecutionPolicyNote(),
		buildConflictResolutionPolicyNote(),
		buildTerminalLogPolicyNote(),
		buildTaskCreationPolicyNote(),
		buildDirectTaskCreationPolicyNote(),
		buildEditorGeneralizationPolicyNote(),
		buildScreenReferencePolicyNote(),
		buildActionVerificationPolicyNote(),
		buildPreClickPreparationPolicyNote(),
		buildPresencePolicyNote(),
		buildDirectCreativeFulfillmentPolicyNote(),
		buildPositiveFeedbackClosurePolicyNote(),
		buildScientificMethodGuide(),
		'Task:',
		String(description || '').trim(),
		'',
		'Instructions: Work autonomously. Edit files directly. Run lint/typecheck after changes. Do not ask questions — make reasonable decisions and proceed.',
		'Autonomy loop: Keep working until the task is actually complete or you hit a concrete external blocker. Do not stop at partial progress or wait for the user to return.',
		'Continuation handling: If the user says "continue working", "keep going", "work on those", "continue working on those", or similar follow-up guidance, treat it as authorization to continue working on the already active task or the most recent unfinished tasks in scope.',
		'Execution handling: If the user gives terse follow-up guidance like "do it properly", "just do it", "don\'t hesitate", or similar, interpret it as a request to continue the active task with a deeper end-to-end pass. Do not ask them to restate the task.',
		'Conflict-resolution handling: If the user tells you to resolve conflicts without over-reading either change, do a light-touch comparison, preserve compatible intent from both sides, resolve the conflict decisively, and continue the active task without asking for the same guidance again.',
		'Terminal-log handling: If the user asks whether you can see terminal output, runtime logs, or console lines on screen, inspect the visible terminal/log pane and answer from the current screen evidence. If the text is unreadable or capture is stale, report that blocker instead of asking again.',
		'Screen-reference handling: If the user gives an ambiguous on-screen correction during active UI work, resolve it from the current screen context, visible target, and readable nearby labels/text before asking them to restate it.',
		'Presence handling: If the user greets you, says "Hello Iris", says your name by itself, or asks where you are during active work, treat it as a presence ping. Answer briefly that you are here and listening; if active work is in progress, include a concise status update instead of asking them to restate the task.',
		'Do not ask the user to restate or re-select the same work unless the prior task context is genuinely missing.',
		'Progress handling: If the user asks what you are doing, what is done already, or asks for progress/status, answer with the current task, concrete completed work so far, the next step, and any blocker instead of asking them to repeat the task.',
		'Task-history handling: If the user asks about tasks you created, queued, or opened for this work, answer with a concise task inventory from the active work state and task history. Summarize each relevant task, its status, completed work so far, the next step, and any blocker. Check tasks.json when available before saying the context is missing.',
		'Task-creation handling: If the user asks you to add, create, or queue a task and the requested work is clear, create it directly from the active context instead of bouncing the request back for clarification. Preserve the requested goal, such as collecting Iris performance benchmarks, in the queued task description.',
		'Editor self-improvement handling: If repeated user friction points out a reusable editor or self-modification pattern, make the broader code change instead of fixing only the single instance. Generalize the behavior across similar editor tasks and stop requiring the same follow-up guidance.',
		'UI action verification: Do not say you clicked something, opened a page, or reached a UI state until fresh screen evidence or a semantic checkpoint confirms it. If the action was sent but not verified, say that clearly and keep investigating.',
		'Direct creative handling: If the user makes a brief casual creative request such as "tell me a poem", fulfill it directly instead of asking for task clarification, workspace context, or project selection.',
		'Positive-feedback handling: If the user gives brief approval like "looks good now" or "this is pretty nice now", treat it as confirmation that the current approach worked. Acknowledge briefly, preserve the active task context, and do not restart task discovery or ask for the same guidance again.',
		'Verification loop: After each meaningful change, run the strongest available verification, inspect the real output, and use that evidence to decide the next step.',
		'Self-input: When one check passes or fails, treat the result as fresh input for the next investigation, edit, or verification step. Drive the loop yourself instead of waiting for more guidance.',
		'Execution framing: Structure the work as hypothesis -> experiment -> implementation -> verification -> self-review. If configuration or prompt tuning matters, explore a small, justified parameter set instead of a single guess.',
		'Reporting: When you emit progress or completion, keep it concise and scientific: current task, evidence-backed completed work, next experiment or next step, and blocker/risk if any.',
	].filter(Boolean).join('\n');
}

module.exports = { buildCodingPrompt };
