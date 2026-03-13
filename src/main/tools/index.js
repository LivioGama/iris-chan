const fs = require('node:fs');
const skills = require('../skills');
const log = require('../logger');
const workspace = require('../workspace');
const { getLearningManager } = require('../automation/service-ref');
const { LOG_PATH } = require('../logger');
const { applyScientificWorkflowDefaults, buildScientificTaskMetadata } = require('../coding/scientific-workflow');

const TOOL_MODULES = ['./input', './apps', './files', './clipboard', './search', './system', './vocab', './self-fix', './create-skill', './input-meta', './design', './3d-gen', './auth', './fix-project', './task-queue', './ui-task'];
const SCIENTIFIC_TASK_TOOLS = new Set(['fix_project', 'self_fix', 'add_task']);
const UI_SEMANTIC_TOOLS = new Set(['open_app', 'type_text', 'press_key', 'scroll', 'click_at', 'double_click', 'mouse_move', 'drag']);
const DIRECT_UI_TOOL = 'run_ui_task';
const SCIENTIFIC_RUNTIME_TRIGGER = /\b(runtime logs?|terminal output|stdout|stderr|ai scientist|scientific workflow|self-improvement|execution bottleneck|idle behavior|action verification|visible runtime logs?)\b/i;
const SEMANTIC_UI_INTENT_PATTERN = /\b(open|go to|goto|search|find|navigate|switch|focus|click|tap|select|choose|scroll to|type into|enter|submit)\b/i;
const EXPLICIT_LOW_LEVEL_PATTERN = /\b(cmd|ctrl|shift|option|alt|escape|return|enter|tab|space|arrow|left|right|up|down|delete|backspace|double[- ]?click|drag|drop|x=|y=|\d+\s*,\s*\d+)\b/i;
const APP_NAME_ONLY_PATTERN = /^[a-z0-9 .+\-_/]+$/i;
const ENABLE_SEMANTIC_UI_FAST_PATH = process.env.IRIS_SEMANTIC_UI_FAST_PATH !== '0';
const ENABLE_SCIENTIFIC_SELF_REVIEW = process.env.IRIS_SCIENTIFIC_SELF_REVIEW !== '0';
const TOOL_SLOW_MS = Number.parseInt(process.env.IRIS_TOOL_SLOW_MS || '1200', 10);
const RUNTIME_LOG_CONTEXT_LINES = Number.parseInt(process.env.IRIS_RUNTIME_LOG_CONTEXT_LINES || '180', 10);
const RUNTIME_LOG_CONTEXT_BYTES = Number.parseInt(process.env.IRIS_RUNTIME_LOG_CONTEXT_BYTES || '24000', 10);
const RUNTIME_LOG_EVIDENCE_LIMIT = 5;

function loadHandlers() {
	const handlers = {};
	for (const mod of TOOL_MODULES) {
		try {
			const exports = require(mod);
			for (const [name, fn] of Object.entries(exports)) {
				if (typeof fn === 'function') {
					handlers[name] = fn;
				}
			}
		} catch (err) {
			log.error('Tools', `Failed to load module ${mod}: ${err.message}`);
		}
	}
	log.info('Tools', `Loaded ${Object.keys(handlers).length} tool handlers`);
	return handlers;
}

let builtinHandlers = loadHandlers();

function reload() {
	for (const mod of TOOL_MODULES) {
		try {
			const resolved = require.resolve(mod);
			delete require.cache[resolved];
		} catch (err) {
			log.warn('Tools', `Could not resolve ${mod} for cache clear: ${err.message}`);
		}
	}
	try {
		builtinHandlers = loadHandlers();
		log.info('Tools', 'Hot-reloaded all tool modules');
	} catch (err) {
		log.error('Tools', `Hot-reload failed: ${err.message}`);
	}
}

function tailLogLines(filePath, { maxBytes = RUNTIME_LOG_CONTEXT_BYTES, maxLines = RUNTIME_LOG_CONTEXT_LINES } = {}) {
	try {
		const stat = fs.statSync(filePath);
		const start = Math.max(0, stat.size - maxBytes);
		const fd = fs.openSync(filePath, 'r');
		try {
			const length = stat.size - start;
			const buffer = Buffer.alloc(length);
			fs.readSync(fd, buffer, 0, length, start);
			return buffer.toString('utf8').trim().split('\n').filter(Boolean).slice(-maxLines);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return [];
	}
}

function summarizeRuntimeLogEvidence(lines = []) {
	if (!lines.length) return '';
	const entries = [
		{
			label: 'Gemini invalid-argument closes',
			matches: lines.filter((line) => /\[Gemini\].*WebSocket closed: code=1007, reason=.*invalid argument/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} setup-invalidating Gemini closes`;
			},
		},
		{
			label: 'Gemini websocket instability',
			matches: lines.filter((line) => /\[Gemini\].*WebSocket closed:/i.test(line)),
			summarize(matchLines) {
				const reasons = [...new Set(
					matchLines
						.map((line) => line.match(/reason=([^]+)$/i)?.[1]?.trim())
						.filter(Boolean)
				)].slice(0, 3);
				return `${matchLines.length} recent reconnect-triggering closes${reasons.length ? ` (${reasons.join('; ')})` : ''}`;
			},
		},
		{
			label: 'Playback interruption churn',
			matches: lines.filter((line) => /\[Voice\].*User interrupted — playback stopped/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} user interruption events observed`;
			},
		},
		{
			label: 'Idle loop churn',
			matches: lines.filter((line) => /\[Voice\].*Unprompted turn #/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} unprompted turns logged in the recent sample`;
			},
		},
		{
			label: 'Empty vocab refresh',
			matches: lines.filter((line) => /\[Vocab\].*Matcher built: 0 terms, 0 corrections/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} periodic zero-term matcher rebuilds`;
			},
		},
		{
			label: 'Idle gate resets',
			matches: lines.filter((line) => /\[Voice\].*(Idle gate closed|User speaking — resetting idle gate)/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} idle-gate state transitions observed`;
			},
		},
		{
			label: 'Kanban file watcher churn',
			matches: lines.filter((line) => /\[Kanban\].*Tasks file changed, notifying renderer/i.test(line)),
			summarize(matchLines) {
				return `${matchLines.length} renderer notifications from tasks.json changes`;
			},
		},
	];

	const summaryLines = entries
		.filter((entry) => entry.matches.length)
		.slice(0, RUNTIME_LOG_EVIDENCE_LIMIT)
		.map((entry) => `- ${entry.label}: ${entry.summarize(entry.matches)}`);

	return summaryLines.length
		? `${summaryLines.join('\n')}\n- Runtime log source: ${LOG_PATH}`
		: '';
}

function deriveRuntimeLogInsights(lines = []) {
	const observations = [];
	const hypotheses = [];
	const experiments = [];
	const hasInvalidArgument = lines.some((line) => /\[Gemini\].*WebSocket closed: code=1007, reason=.*invalid argument/i.test(line));
	const hasServiceUnavailable = lines.some((line) => /\[Gemini\].*WebSocket closed: code=1011/i.test(line));
	const hasIdleTurns = lines.some((line) => /\[Voice\].*Unprompted turn #/i.test(line));
	const hasInterruptions = lines.some((line) => /\[Voice\].*User interrupted — playback stopped/i.test(line));
	const hasEmptyVocab = lines.some((line) => /\[Vocab\].*Matcher built: 0 terms, 0 corrections/i.test(line));

	if (hasInvalidArgument) {
		observations.push('Gemini Live sessions are sometimes rejected with invalid-argument closes.');
		hypotheses.push('The setup payload occasionally exceeds the API tolerance or includes an unsupported combination of options.');
		experiments.push('Retry with a degraded Gemini setup profile before broad behavior changes.');
	}
	if (hasServiceUnavailable) {
		observations.push('Gemini Live also shows transient 1011 service-unavailable reconnects.');
		hypotheses.push('Transport instability should be handled separately from local setup validation failures.');
	}
	if (hasIdleTurns || hasInterruptions) {
		observations.push('Voice logs show unprompted turns and repeated playback interruptions during active work.');
		hypotheses.push('Idle-response gating is happening too late and should suppress spillover before audio is emitted.');
		experiments.push('Add interruption-aware cooldowns and background-task-aware response suppression, then verify from logs.');
	}
	if (hasEmptyVocab) {
		observations.push('Vocabulary refresh keeps rebuilding an empty matcher on a periodic loop.');
		hypotheses.push('Unchanged empty vocabulary snapshots are adding noise and avoidable work.');
		experiments.push('Skip duplicate vocabulary rebuilds and throttle empty-state logging.');
	}

	return {
		observations,
		hypotheses,
		experiments,
	};
}

function enrichArgsWithScientificRuntimeEvidence(name, args = {}) {
	if (!SCIENTIFIC_TASK_TOOLS.has(name)) return args || {};
	const description = String(args?.description || '').trim();
	if (!description || !SCIENTIFIC_RUNTIME_TRIGGER.test(description) || /runtime log evidence:/i.test(description)) {
		return args || {};
	}
	const runtimeLines = tailLogLines(LOG_PATH);
	const runtimeEvidence = summarizeRuntimeLogEvidence(runtimeLines);
	if (!runtimeEvidence) return args || {};
	const runtimeInsights = deriveRuntimeLogInsights(runtimeLines);
	const nextDescription = `${description}\n\nRUNTIME LOG EVIDENCE:\n${runtimeEvidence}`;
	const nextArgs = {
		...(args || {}),
		description: nextDescription,
	};
	const scientificMetadata = args?.scientific_metadata?.workflow === 'ai_scientist_v1' || !args?.scientific_metadata
		? buildScientificTaskMetadata({
			description: nextDescription,
			target: nextArgs.target,
			projectPath: nextArgs.project_path || nextArgs._cwd || null,
		})
		: { ...(args.scientific_metadata || {}) };
	scientificMetadata.runtimeEvidence = {
		source: LOG_PATH,
		summary: runtimeEvidence,
		observations: runtimeInsights.observations,
	};
	if (runtimeInsights.hypotheses.length) {
		scientificMetadata.runtimeEvidence.hypotheses = runtimeInsights.hypotheses;
		scientificMetadata.hypotheses = [
			...runtimeInsights.hypotheses,
			...(scientificMetadata.hypotheses || []),
		].filter(Boolean).slice(0, 5);
	}
	if (runtimeInsights.experiments.length) {
		scientificMetadata.runtimeEvidence.experiments = runtimeInsights.experiments;
		scientificMetadata.experimentPlan = [
			...runtimeInsights.experiments,
			...(scientificMetadata.experimentPlan || []),
		].filter(Boolean).slice(0, 6);
	}
	nextArgs.scientific_metadata = scientificMetadata;
	log.info('Tools', `Attached runtime-log evidence to ${name} task description from ${LOG_PATH}`);
	return nextArgs;
}

function normalizeWhitespace(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferUserIntentText(name, args = {}) {
	if (!args || typeof args !== 'object') return '';
	if (typeof args.goal === 'string' && args.goal.trim()) return normalizeWhitespace(args.goal);
	if (typeof args.user_intent === 'string' && args.user_intent.trim()) return normalizeWhitespace(args.user_intent);
	if (typeof args.description === 'string' && args.description.trim()) return normalizeWhitespace(args.description);
	if (name === 'open_app') return normalizeWhitespace(args.name || '');
	return '';
}

function shouldPromoteToSemanticUiTool(name, args = {}) {
	if (!ENABLE_SEMANTIC_UI_FAST_PATH) return false;
	if (!UI_SEMANTIC_TOOLS.has(name) || name === DIRECT_UI_TOOL) return false;
	const intent = inferUserIntentText(name, args);
	if (!intent || intent.length < 12) return false;
	if (!SEMANTIC_UI_INTENT_PATTERN.test(intent)) return false;
	if (EXPLICIT_LOW_LEVEL_PATTERN.test(intent)) return false;
	if (name === 'open_app' && APP_NAME_ONLY_PATTERN.test(intent) && !/\s/.test(intent.replace(/\.app$/i, ''))) {
		return false;
	}
	return true;
}

function applyExecutionPolicy(name, args = {}) {
	const intent = inferUserIntentText(name, args);
	if (shouldPromoteToSemanticUiTool(name, args)) {
		const nextArgs = {
			goal: intent,
			promoted_from_tool: name,
		};
		if (typeof args?.app_hint === 'string' && args.app_hint.trim()) {
			nextArgs.app_hint = args.app_hint.trim();
		}
		if (typeof args?.success_signal === 'string' && args.success_signal.trim()) {
			nextArgs.success_signal = args.success_signal.trim();
		}
		return {
			name: DIRECT_UI_TOOL,
			args: nextArgs,
			policy: {
				kind: 'semantic_ui_promotion',
				originalTool: name,
				intent,
			},
		};
	}

	return {
		name,
		args,
		policy: {
			kind: 'default',
			intent,
		},
	};
}

function buildScientificSelfReview(name, args, result, durationMs, policy) {
	if (!ENABLE_SCIENTIFIC_SELF_REVIEW) return null;
	if (!SCIENTIFIC_TASK_TOOLS.has(name) || args?.self_review === false) return null;
	const summary = {
		tool: name,
		durationMs,
		ok: result?.ok !== false,
		workflowStage: result?.ok === false ? 'follow_up_needed' : 'verified',
		route: policy?.kind || 'default',
		hypothesis: normalizeWhitespace(args?.scientific_metadata?.hypotheses?.[0] || args?.description || ''),
		verification: normalizeWhitespace(result?.result || ''),
		regressionRisk: result?.ok === false
			? 'Observed failure requires another experiment before completion.'
			: durationMs >= TOOL_SLOW_MS
				? 'Successful but slower than the fast-path target; monitor follow-up latency.'
				: 'No regression signal observed in this execution.',
	};
	if (!summary.hypothesis) delete summary.hypothesis;
	return summary;
}

async function execute(name, args) {
	try {
		return await executeWithTelemetry(name, args);
	} finally {
		// placeholder to preserve function name in stack traces
	}
}

async function executeWithTelemetry(name, args) {
	const startedAt = Date.now();
	let ok = false;
	try {
		const result = await executeCore(name, args, (value) => {
			ok = value;
		});
		return result;
	} finally {
		const durationMs = Date.now() - startedAt;
		const level = durationMs >= TOOL_SLOW_MS ? 'warn' : 'info';
		log[level]('Tools', `execute(${name}) ${ok ? 'ok' : 'fail'} in ${durationMs}ms`);
	}
}

async function executeCore(name, args, markOk) {
	const learningManager = getLearningManager();
	const executionPolicy = applyExecutionPolicy(name, args || {});
	if (executionPolicy.policy?.kind === 'semantic_ui_promotion') {
		log.info('Tools', `Promoted ${name} to ${DIRECT_UI_TOOL} for semantic UI intent: ${executionPolicy.policy.intent}`);
	}
	const resolved = learningManager?.resolveToolRequest?.(executionPolicy.name, executionPolicy.args || {}) || { name: executionPolicy.name, args: executionPolicy.args };
	name = resolved.name || name;
	args = applyScientificWorkflowDefaults(name, resolved.args || args || {});
	args = enrichArgsWithScientificRuntimeEvidence(name, args);
	const sequenceRemainder = Array.isArray(resolved.sequenceRemainder) ? resolved.sequenceRemainder : [];
	const startedAt = Date.now();

	if (name === 'set_workspace') {
		const dir = args?.directory || args?.path || '';
		if (!dir) return { ok: false, result: 'No directory provided' };
		const result = workspace.set(dir);
		markOk(result?.ok !== false);
		return result;
	}
	if (name === 'get_workspace') {
		markOk(true);
		return { ok: true, result: workspace.get() };
	}

	if (name === 'use_skill') {
		const result = skills.getSkillContent(args?.skill_name || '');
		markOk(result?.ok !== false);
		return result;
	}

	const builtin = builtinHandlers[name];
	if (builtin) {
		try {
			const firstResult = await builtin(args || {});
			if (firstResult?.ok === false || !sequenceRemainder.length) {
				const selfReview = buildScientificSelfReview(name, args, firstResult, Date.now() - startedAt, executionPolicy.policy);
				if (selfReview) {
					log.info('Tools', `Scientific self-review: ${JSON.stringify(selfReview)}`);
				}
				markOk(firstResult?.ok !== false);
				return firstResult;
			}
			let lastResult = firstResult;
			for (const step of sequenceRemainder) {
				const handler = builtinHandlers[step.name];
				if (!handler) {
					return { ok: false, result: `Learned tool sequence references unknown tool: ${step.name}` };
				}
				lastResult = await handler(applyScientificWorkflowDefaults(step.name, step.args || {}));
				if (lastResult?.ok === false) return lastResult;
			}
			const selfReview = buildScientificSelfReview(name, args, lastResult, Date.now() - startedAt, executionPolicy.policy);
			if (selfReview) {
				log.info('Tools', `Scientific self-review: ${JSON.stringify(selfReview)}`);
			}
			markOk(true);
			return {
				ok: true,
				result: lastResult?.result || firstResult?.result || 'done',
			};
		} catch (err) {
			log.error('Tools', `Handler error in ${name}: ${err.message}`);
			return { ok: false, result: `Tool error: ${err.message}` };
		}
	}

	const skillHandler = skills.getHandler(name);
	if (skillHandler) {
		try {
			const result = await skillHandler(args || {});
			const selfReview = buildScientificSelfReview(name, args, result, Date.now() - startedAt, executionPolicy.policy);
			if (selfReview) {
				log.info('Tools', `Scientific self-review: ${JSON.stringify(selfReview)}`);
			}
			markOk(result?.ok !== false);
			return result;
		} catch (err) {
			return { ok: false, result: `Skill error: ${err.message}` };
		}
	}

	return { ok: false, result: `Unknown tool: ${name}` };
}

module.exports = {
	execute,
	reload,
	_private: {
		applyExecutionPolicy,
		buildScientificSelfReview,
		inferUserIntentText,
		shouldPromoteToSemanticUiTool,
		tailLogLines,
		summarizeRuntimeLogEvidence,
		deriveRuntimeLogInsights,
		enrichArgsWithScientificRuntimeEvidence,
	},
};
