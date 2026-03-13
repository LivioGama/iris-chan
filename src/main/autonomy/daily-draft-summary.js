const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IRIS_DIR = path.join(os.homedir(), '.iris');
const LEARNING_LOG_PATH = path.join(IRIS_DIR, 'learning_log.json');
const SELF_FIX_ISSUES_PATH = path.join(IRIS_DIR, 'self_fix_issues.json');

function safeReadJson(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

function escapeHtml(value = '') {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function truncateText(value = '', limit = 180) {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function summarizeClassifications(events = []) {
	const counts = new Map();
	for (const event of events) {
		const key = String(event?.classification || '').trim() || 'unknown';
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return [...counts.entries()]
		.sort((left, right) => {
			if (right[1] !== left[1]) return right[1] - left[1];
			return left[0].localeCompare(right[0]);
		})
		.slice(0, 3)
		.map(([classification, count]) => `${classification} (${count})`);
}

function summarizeIssues(issues = []) {
	return [...issues]
		.sort((left, right) => {
			const countDelta = Number(right?.count || 0) - Number(left?.count || 0);
			if (countDelta !== 0) return countDelta;
			return String(left?.issueSignature || '').localeCompare(String(right?.issueSignature || ''));
		})
		.slice(0, 3)
		.map((issue) => truncateText(issue?.canonicalDescription || issue?.description || issue?.issueSignature || 'Unnamed issue', 140));
}

function summarizeRecentGuidance(events = []) {
	return [...events]
		.slice(-3)
		.reverse()
		.map((event) => truncateText(event?.guidanceText || event?.userText || event?.issueSignature || '', 140))
		.filter(Boolean);
}

function loadDailyDraftSignals() {
	const log = safeReadJson(LEARNING_LOG_PATH, { events: [] });
	const issues = safeReadJson(SELF_FIX_ISSUES_PATH, { issues: [] });
	const events = Array.isArray(log?.events) ? log.events : [];
	const issueList = Array.isArray(issues?.issues) ? issues.issues : [];
	const activeIssues = issueList.filter((issue) => String(issue?.status || '') !== 'resolved');
	const resolvedIssues = issueList.filter((issue) => String(issue?.status || '') === 'resolved');

	return {
		events,
		issueList,
		activeIssues,
		resolvedIssues,
		topClassifications: summarizeClassifications(events.slice(-20)),
		topIssues: summarizeIssues(activeIssues),
		recentGuidance: summarizeRecentGuidance(events),
	};
}

function buildDailyDraft({ date, signals = loadDailyDraftSignals() } = {}) {
	const totalEvents = signals.events.length;
	const activeIssueCount = signals.activeIssues.length;
	const resolvedIssueCount = signals.resolvedIssues.length;
	const topClassifications = signals.topClassifications.length
		? signals.topClassifications.join(', ')
		: 'no repeated learning patterns yet';
	const topIssues = signals.topIssues.length
		? signals.topIssues.join(' | ')
		: 'no unresolved self-fix issues';
	const guidance = signals.recentGuidance.length
		? signals.recentGuidance.join(' | ')
		: 'No recent operator corrections were captured.';
	const summary = [
		`Signals: ${totalEvents} learning events, ${activeIssueCount} active issues, ${resolvedIssueCount} resolved issues.`,
		`Patterns: ${topClassifications}.`,
		`Focus: ${topIssues}.`,
		`Recent guidance: ${guidance}.`,
	].join(' ');

	const html = [
		`<p>Daily autonomy note for ${escapeHtml(date)}.</p>`,
		`<p><strong>Signals:</strong> ${escapeHtml(`${totalEvents} learning events, ${activeIssueCount} active issues, ${resolvedIssueCount} resolved issues`)}</p>`,
		`<p><strong>Top patterns:</strong> ${escapeHtml(topClassifications)}</p>`,
		`<p><strong>Current focus:</strong> ${escapeHtml(topIssues)}</p>`,
		`<p><strong>Recent guidance:</strong> ${escapeHtml(guidance)}</p>`,
	].join('');

	return {
		title: `Iris Daily Note — ${date}`,
		summary,
		html,
		signals: {
			totalEvents,
			activeIssueCount,
			resolvedIssueCount,
		},
	};
}

module.exports = {
	buildDailyDraft,
	loadDailyDraftSignals,
	LEARNING_LOG_PATH,
	SELF_FIX_ISSUES_PATH,
};
