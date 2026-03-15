const AX_PRIORITY_ROLES = ['AXTextField', 'AXTextArea', 'AXButton', 'AXLink', 'AXStaticText', 'AXMenuItem', 'AXTabGroup'];

function summarizeAx(axSnapshot, limit = 20) {
	if (!axSnapshot?.ok || !Array.isArray(axSnapshot.elements)) return '';
	const parts = [];
	if (axSnapshot.windowTitle) parts.push(`[Window: "${axSnapshot.windowTitle}"]`);
	if (axSnapshot.focused) {
		const f = axSnapshot.focused;
		const label = f.title || f.value || f.description || '';
		if (label) parts.push(`[Focused: ${f.role || 'element'} "${truncateText(label, 60)}"]`);
	}
	const seen = new Set();
	const prioritized = axSnapshot.elements
		.filter((el) => {
			if (!el) return false;
			const text = el.title || el.value || el.description || '';
			if (!text || seen.has(text)) return false;
			seen.add(text);
			return true;
		})
		.sort((a, b) => {
			const aIdx = AX_PRIORITY_ROLES.indexOf(a.role);
			const bIdx = AX_PRIORITY_ROLES.indexOf(b.role);
			return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
		})
		.slice(0, limit);
	for (const el of prioritized) {
		const text = el.title || el.value || el.description || '';
		parts.push(`[${el.role || 'element'} "${truncateText(text, 50)}"]`);
	}
	return parts.join(' ');
}

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

function buildIntentContext({ learningManager, memoryStore, behaviorMode, frontmostApp, screenMeta, windowTitles, axSnapshot } = {}) {
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
		windowTitles: Array.isArray(windowTitles) ? windowTitles.filter(Boolean) : [],
		screenContent: summarizeAx(axSnapshot),
	};
}

module.exports = { buildIntentContext, getTimeOfDay, summarizeTools, summarizeTurns, summarizePolicies, summarizeAx };
