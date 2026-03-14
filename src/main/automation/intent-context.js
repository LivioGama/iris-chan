function getTimeOfDay() {
	const hour = new Date().getHours();
	if (hour < 6) return 'night';
	if (hour < 12) return 'morning';
	if (hour < 18) return 'afternoon';
	return 'evening';
}

function truncateText(text, maxLen = 200) {
	const s = String(text || '').trim();
	return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

function summarizeTools(toolExecutions = [], limit = 10) {
	return toolExecutions.slice(-limit).map((t) => ({
		name: t.name || 'unknown',
		success: t.success !== false,
		durationMs: Number(t.durationMs || 0),
	}));
}

function summarizeTurns(turns = [], limit = 5) {
	return turns.slice(-limit).map((t) => ({
		role: t.role || 'unknown',
		text: truncateText(t.text),
	}));
}

function summarizePolicies(entries = []) {
	return entries
		.filter((e) => e.kind === 'fallback_policy' && e.value?.enabled !== false)
		.map((e) => ({
			key: e.key,
			message: truncateText(e.value?.message, 100),
		}));
}

function buildIntentContext({ learningManager, memoryStore, behaviorMode, frontmostApp, screenMeta } = {}) {
	const recentTools = summarizeTools(learningManager?.recentToolExecutions);
	const recentTurns = summarizeTurns(learningManager?.recentTurns);
	const activePolicies = summarizePolicies(memoryStore?.getEntries?.() || []);

	return {
		frontmostApp: String(frontmostApp || '').trim() || 'unknown',
		recentTools,
		recentTurns,
		behaviorMode: String(behaviorMode || 'silent'),
		timeOfDay: getTimeOfDay(),
		activePolicies,
		screenMeta: screenMeta
			? { width: screenMeta.imageWidth || 0, height: screenMeta.imageHeight || 0 }
			: null,
	};
}

module.exports = { buildIntentContext, getTimeOfDay, summarizeTools, summarizeTurns, summarizePolicies };
