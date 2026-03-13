const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const serviceRef = require('../src/main/automation/service-ref');
const { buildCodingPrompt } = require('../src/main/coding/prompt');

console.log('Running coding prompt tests...');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-coding-prompt-'));
}

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

{
	const cwd = createTempDir();
	writeJson(path.join(cwd, 'package.json'), { name: 'iris-test', description: 'test project' });
	const previous = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore({
		getValue(key, fallback = null) {
			if (key === 'policy.autonomous_self_drive') {
				return {
					message: 'During autonomous coding or self-fix work, keep iterating without waiting for more user input. Self-verify each step, use verification results as the next input, keep working until the user returns, and clear the remaining todo/backlog before stopping unless a concrete blocker is reached.',
				};
			}
			if (key === 'policy.progress_accountability') {
				return {
					message: 'When the user asks what you are doing or what is already done during active work, answer with a concise progress report: current task, concrete completed work, next step, and any blocker. Do not ask them to restate the task if active work context already exists.',
				};
			}
			if (key === 'policy.task_creation_accountability') {
				return {
					message: 'When the user asks about tasks you created, queued, or opened for the current work, answer from the active work state and task history instead of asking them to restate it. Summarize each relevant task for this request, its status, completed work, next step, and any blocker. Check tasks.json when available before saying context is missing.',
				};
			}
			if (key === 'policy.direct_task_creation') {
				return {
					message: 'When the user asks you to add, create, or queue a task and the requested work is clear, create the task directly instead of asking them to restate it. Preserve the requested goal in the task description, infer the active project context when available, and only ask follow-up questions when the task target is genuinely ambiguous.',
				};
			}
			if (key === 'policy.thorough_execution') {
				return {
					message: 'When the user gives terse follow-up guidance meaning "do it properly", "just do it", or "don\'t hesitate" during active work, continue the current task without asking them to restate it. Take a stronger end-to-end pass: investigate the root cause, complete the action decisively, rerun verification, and stop only at a concrete blocker.',
				};
			}
			if (key === 'policy.conflict_resolution_continuation') {
				return {
					message: 'When resolving conflicts between two change sets during active work, do a light-touch comparison first. Do not over-read either side if the intent is already clear. Preserve compatible intent from both changes, resolve the conflict decisively, and continue the active task without asking for the same guidance again.',
				};
			}
			if (key === 'policy.editor_self_improvement_generalization') {
				return {
					message: 'When repeated user friction reveals a reusable editor or self-modification pattern, update your own code in a generic way instead of fixing only the narrow case. Generalize the learned stop/continuation behavior across similar editor tasks and do not ask for the same guidance again when the surrounding pattern matches.',
				};
			}
			if (key === 'policy.action_verification') {
				return {
					message: 'For screen-based actions, never claim "clicked", "opened", or "went there" until a fresh screenshot, DOM/app checkpoint, or other direct verification confirms the result. Do not rely on stale screenshots when deciding where to click. If verification is unavailable, say the action is unverified or blocked instead of claiming success.',
				};
			}
			if (key === 'policy.pre_click_preparation') {
				return {
					message: 'When a UI task depends on a specific app or window, open or focus that app first, refresh the screen context, and only then use pointer actions or resolve visible targets. Treat run_ui_task -> open_app recovery as missing preparation rather than a reason to ask for the same guidance again.',
				};
			}
			if (key === 'policy.direct_creative_fulfillment') {
				return {
					message: 'When the user makes a short casual creative request such as asking for a poem, joke, caption, or short story, fulfill it directly instead of asking for task clarification or workspace context. Treat brief transliterated variants like "tell me a poem" as the same request when the intent is clear.',
				};
			}
			return fallback;
		},
	});

	try {
		const prompt = buildCodingPrompt({
			cwd,
			target: 'iris',
			description: 'Keep fixing the active task without asking follow-up questions.',
		});

		assert.match(prompt, /continue working on the already active task/i, 'coding prompt should tell the agent to keep progressing active work');
		assert.match(prompt, /continue working on those/i, 'coding prompt should mention the repeated continue-working follow-up explicitly');
		assert.match(prompt, /Learned execution policy:/, 'coding prompt should expose the learned thorough-execution policy');
		assert.match(prompt, /do it properly/i, 'coding prompt should surface the do-it-properly execution guidance');
		assert.match(prompt, /don't hesitate/i, 'coding prompt should surface the anti-hesitation execution guidance');
		assert.match(prompt, /Learned conflict-resolution policy:/, 'coding prompt should expose the learned conflict-resolution policy');
		assert.match(prompt, /light-touch comparison/i, 'coding prompt should surface the light-touch conflict-resolution guidance');
		assert.match(prompt, /resolve conflicts without over-reading either change/i, 'coding prompt should explicitly coach conflict resolution continuation');
		assert.match(prompt, /do not ask the user to restate or re-select the same work/i, 'coding prompt should ban repetitive clarification');
		assert.match(prompt, /Learned progress policy:/, 'coding prompt should expose the learned progress-accountability policy');
		assert.match(prompt, /Learned task-history policy:/, 'coding prompt should expose the learned task-history accountability policy');
		assert.match(prompt, /Learned task-creation policy:/, 'coding prompt should expose the learned direct task-creation policy');
		assert.match(prompt, /Learned editor-improvement policy:/, 'coding prompt should expose the learned editor self-improvement policy');
		assert.match(prompt, /Learned action-verification policy:/, 'coding prompt should expose the learned action-verification policy');
		assert.match(prompt, /Learned UI-preparation policy:/, 'coding prompt should expose the learned UI preparation policy');
		assert.match(prompt, /Learned direct-creative policy:/, 'coding prompt should expose the learned direct-creative fulfillment policy');
		assert.match(prompt, /do not say you clicked something, opened a page, or reached a ui state until fresh screen evidence or a semantic checkpoint confirms it/i, 'coding prompt should explicitly block unverified UI success claims');
		assert.match(prompt, /open or focus that app first, refresh the screen context, and only then use pointer actions/i, 'coding prompt should coach app/window preparation before pointer actions');
		assert.match(prompt, /brief casual creative request such as "tell me a poem"/i, 'coding prompt should explicitly coach direct fulfillment of short creative asks');
		assert.match(prompt, /what you are doing, what is done already, or asks for progress\/status/i, 'coding prompt should explicitly coach status answers for active work');
		assert.match(prompt, /asks about tasks you created, queued, or opened for this work/i, 'coding prompt should explicitly coach created-task inventory answers');
		assert.match(prompt, /Check tasks\.json when available before saying the context is missing/i, 'coding prompt should direct the agent to consult tasks.json for task-history answers');
		assert.match(prompt, /asks you to add, create, or queue a task and the requested work is clear, create it directly/i, 'coding prompt should explicitly coach direct task creation when the request is clear');
		assert.match(prompt, /collecting Iris performance benchmarks/i, 'coding prompt should include the benchmark-task example');
		assert.match(prompt, /generic way instead of fixing only the narrow case/i, 'coding prompt should surface the generic editor self-improvement rule');
		assert.match(prompt, /Generalize the behavior across similar editor tasks/i, 'coding prompt should instruct broader editor-task generalization');
		assert.match(prompt, /AI Scientist workflow:/, 'coding prompt should include the AI scientist workflow section');
		assert.match(prompt, /hypothesis -> experiment -> implementation -> verification -> self-review/i, 'coding prompt should explicitly sequence the scientific workflow');
		assert.match(prompt, /small, justified parameter set/i, 'coding prompt should direct small parameter exploration instead of single guesses');
		assert.match(prompt, /current task, evidence-backed completed work, next experiment or next step, and blocker/i, 'coding prompt should require scientific progress phrasing');
	} finally {
		serviceRef.setMemoryStore(previous);
	}
}

console.log('Coding prompt tests passed.');
