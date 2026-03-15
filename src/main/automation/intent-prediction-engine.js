const { info, error: logError } = require('../logger');
const { buildIntentContext } = require('./intent-context');

const TAG = 'IntentPrediction';

const INTENT_KINDS = ['reply', 'next-step', 'warning', 'fix', 'follow-up', 'opportunity'];

const PREDICTION_SYSTEM_PROMPT = `You are a context-aware intent prediction engine for a desktop AI assistant called Iris.
Your job is to predict what the user will likely want to do next based on their current context.

Available intent kinds: ${INTENT_KINDS.join(', ')}

Intent kind definitions:
- reply: User likely needs to respond to a message or conversation
- next-step: User's workflow suggests a natural next action (commit code, save file, switch app, etc.)
- warning: Something in the user's context suggests a potential issue (unsaved changes, errors visible, etc.)
- fix: User appears stuck or encountering errors that could be resolved
- follow-up: A previous action needs a logical continuation
- opportunity: An optimization or improvement the user might appreciate

You also understand these user intent patterns from conversation:
- autonomous_continuation: user wants you to keep working, self-verify, clear backlog
- progress_accountability: user asks what you're doing or what's done
- screen_reference: user references something visible on screen
- action_verification: user wants proof actions actually happened
- positive_feedback: user confirms current approach works
- cancellation: user dismisses or cancels current action
- preparation_needed: user wants proper setup before executing actions
- capability_overview: user asks what you can do

Respond with JSON only. No markdown, no explanation.`;

const PREDICTION_USER_TEMPLATE = `Current context:
- Frontmost app: {frontmostApp}
- Window titles: {windowTitles}
- Behavior mode: {behaviorMode}
- Time of day: {timeOfDay}
- Workspace: {workspacePath}
- Project type: {projectType}
- Git branch: {gitBranch}

Screen content (UI elements visible):
{screenContent}

Recent tool executions (most recent last):
{recentTools}

Recent conversation (most recent last):
{recentTurns}

Active learned policies:
{activePolicies}

Historical patterns for this app/time:
{temporalPatterns}

Based on this context, predict the user's most likely next intent(s).
Return JSON: { "intents": [{ "type": "<intent kind>", "confidence": <0-1>, "description": "<why>", "suggestedAction": "<what to suggest>" }], "toolHints": ["<tool names to pre-load>"] }
Return at most 3 intents, ordered by confidence. Only include intents with confidence >= 0.5.
If nothing is confidently predictable, return { "intents": [], "toolHints": [] }.`;

const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier for a desktop AI assistant called Iris.
Classify the user's message into one of these types:
- memory: a correction or guidance that should be stored as a policy
- core-gap: a structural capability gap that needs code changes
- skill: a reusable tool recovery pattern
- null: not a correction or guidance, just a normal request

For "memory" type, also return a policy key and payload.

Respond with JSON only. No markdown.`;

const CLASSIFY_USER_TEMPLATE = `User message: "{text}"

Recent tool executions:
{recentTools}

Recent conversation:
{recentTurns}

Classify this message. Return JSON:
{ "type": "<memory|core-gap|skill|null>", "key": "<policy key if memory>", "reason": "<brief explanation>", "payload": <policy payload object if memory, else null> }
If the message is a normal request (not a correction/guidance), return { "type": null, "key": null, "reason": "normal request", "payload": null }.`;

function hashString(input = '') {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) - hash) + input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function formatTools(tools = []) {
	if (!tools.length) return '(none)';
	return tools.map((t) => `  ${t.name} — ${t.success ? 'ok' : 'FAILED'} (${t.durationMs}ms)`).join('\n');
}

function formatTurns(turns = []) {
	if (!turns.length) return '(none)';
	return turns.map((t) => `  [${t.role}] ${t.text}`).join('\n');
}

function formatPolicies(policies = []) {
	if (!policies.length) return '(none)';
	return policies.map((p) => `  ${p.key}: ${p.message}`).join('\n');
}

function formatTemporalPatterns(patterns = []) {
	if (!patterns.length) return '(none)';
	return patterns.map((p) => `  ${p.intentType}: ${p.count} occurrences (${p.timeOfDay}, ${p.appName})`).join('\n');
}

function fillTemplate(template, context) {
	return template
		.replace('{frontmostApp}', context.frontmostApp)
		.replace('{windowTitles}', (context.windowTitles || []).join(', ') || '(none)')
		.replace('{behaviorMode}', context.behaviorMode)
		.replace('{timeOfDay}', context.timeOfDay)
		.replace('{workspacePath}', context.workspacePath || '(none)')
		.replace('{projectType}', context.projectType || 'unknown')
		.replace('{gitBranch}', context.gitBranch || '(none)')
		.replace('{screenContent}', context.screenContent || '(not available)')
		.replace('{recentTools}', formatTools(context.recentTools))
		.replace('{recentTurns}', formatTurns(context.recentTurns))
		.replace('{activePolicies}', formatPolicies(context.activePolicies))
		.replace('{temporalPatterns}', formatTemporalPatterns(context.temporalPatterns));
}

class IntentPredictionEngine {
	constructor({ groqClient, learningManager, memoryStore, eventBus, worldState, patternStore }) {
		this._groq = groqClient;
		this._learningManager = learningManager;
		this._memoryStore = memoryStore;
		this._eventBus = eventBus;
		this._worldState = worldState || null;
		this._patternStore = patternStore || null;
		this._loopInterval = null;
		this._loopInFlight = false;
		this._lastFingerprint = '';
	}

	get available() {
		return this._groq?.available === true;
	}

	async predict({ frontmostApp, screenMeta, behaviorMode, windowTitles, axSnapshot } = {}) {
		if (!this.available) return { intents: [], toolHints: [], contextFingerprint: '' };

		const context = buildIntentContext({
			learningManager: this._learningManager,
			memoryStore: this._memoryStore,
			behaviorMode,
			frontmostApp,
			screenMeta,
			windowTitles,
			axSnapshot,
			patternStore: this._patternStore,
		});

		const fingerprint = hashString([
			context.frontmostApp,
			context.behaviorMode,
			context.timeOfDay,
			(context.recentTools[context.recentTools.length - 1]?.name || ''),
			(context.windowTitles || []).slice(0, 3).join(','),
			hashString((context.recentTurns[context.recentTurns.length - 1]?.text || '')),
		].join('|'));

		if (fingerprint === this._lastFingerprint) {
			return { intents: [], toolHints: [], contextFingerprint: fingerprint };
		}

		const userMessage = fillTemplate(PREDICTION_USER_TEMPLATE, context);

		const result = await this._groq.complete(
			[
				{ role: 'system', content: PREDICTION_SYSTEM_PROMPT },
				{ role: 'user', content: userMessage },
			],
			{ temperature: 0.2, maxTokens: 300, responseFormat: { type: 'json_object' } },
		);

		if (!result || !Array.isArray(result.intents)) {
			return { intents: [], toolHints: [], contextFingerprint: fingerprint };
		}

		this._lastFingerprint = fingerprint;

		const intents = result.intents
			.filter((i) => i && typeof i.type === 'string' && typeof i.confidence === 'number')
			.filter((i) => i.confidence >= 0.5 && INTENT_KINDS.includes(i.type))
			.slice(0, 3)
			.map((i) => ({
				type: i.type,
				confidence: Math.min(1, Math.max(0, i.confidence)),
				description: String(i.description || '').trim(),
				suggestedAction: String(i.suggestedAction || '').trim(),
			}));

		const toolHints = Array.isArray(result.toolHints)
			? result.toolHints.filter((h) => typeof h === 'string').slice(0, 5)
			: [];

		if (this._patternStore && intents.length > 0) {
			for (const intent of intents) {
				this._patternStore.recordPrediction({
					appName: context.frontmostApp,
					timeOfDay: context.timeOfDay,
					intentType: intent.type,
				});
			}
		}

		info(TAG, `Predicted ${intents.length} intent(s) for ${frontmostApp || 'unknown'}: ${intents.map((i) => `${i.type}@${i.confidence.toFixed(2)}`).join(', ') || 'none'}`);

		return { intents, toolHints, contextFingerprint: fingerprint };
	}

	async classifyText(text, { recentTools, recentTurns } = {}) {
		if (!this.available) return null;
		if (!text || typeof text !== 'string') return null;

		const toolsSummary = formatTools(recentTools || []);
		const turnsSummary = formatTurns(recentTurns || []);

		const userMessage = CLASSIFY_USER_TEMPLATE
			.replace('{text}', text.slice(0, 500))
			.replace('{recentTools}', toolsSummary)
			.replace('{recentTurns}', turnsSummary);

		const result = await this._groq.complete(
			[
				{ role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
				{ role: 'user', content: userMessage },
			],
			{ temperature: 0.1, maxTokens: 200, responseFormat: { type: 'json_object' } },
		);

		if (!result || result.type === null || result.type === 'null') return null;

		const validTypes = ['memory', 'core-gap', 'skill'];
		if (!validTypes.includes(result.type)) return null;

		info(TAG, `Classified text as ${result.type}: ${result.reason || 'n/a'}`);

		return {
			type: result.type,
			key: result.key || null,
			reason: String(result.reason || ''),
			payload: result.payload || null,
		};
	}

	startPredictionLoop(intervalMs) {
		this.stopPredictionLoop();
		const interval = intervalMs || Number(process.env.IRIS_INTENT_PREDICTION_INTERVAL_MS) || 10000;
		info(TAG, `Starting prediction loop (${interval}ms interval)`);
		this._loopInterval = setInterval(() => {
			this._loopTick().catch((err) => logError(TAG, `Loop tick failed: ${err?.message || err}`));
		}, interval);
	}

	stopPredictionLoop() {
		if (this._loopInterval) {
			clearInterval(this._loopInterval);
			this._loopInterval = null;
		}
		this._loopInFlight = false;
	}

	async _loopTick() {
		if (this._loopInFlight) return;
		this._loopInFlight = true;
		try {
			let frontmostApp;
			let windowTitles;
			let axSnapshot;
			if (this._worldState) {
				const appResult = await this._worldState.getFrontmostApp().catch(() => ({ ok: false }));
				if (appResult.ok) {
					frontmostApp = appResult.name;
					windowTitles = appResult.windows;
				}
				axSnapshot = await this._worldState.snapshotAccessibility().catch(() => ({ ok: false }));
				this._worldState.invalidate();
			}
			const prediction = await this.predict({ frontmostApp, windowTitles, axSnapshot });
			if (prediction.intents.length > 0 && this._eventBus) {
				this._eventBus.emitEvent('INTENT_PREDICTION', {
					intents: prediction.intents,
					toolHints: prediction.toolHints,
					contextFingerprint: prediction.contextFingerprint,
				}, 'intent-prediction-engine');
			}
		} finally {
			this._loopInFlight = false;
		}
	}
}

module.exports = { IntentPredictionEngine };
