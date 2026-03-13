const { normalizeUrl } = require('./browser-adapter');

const APP_ALIASES = new Map([
	['safari', 'Safari'],
	['chrome', 'Google Chrome'],
	['google chrome', 'Google Chrome'],
	['arc', 'Arc'],
	['brave', 'Brave Browser'],
	['brave browser', 'Brave Browser'],
	['edge', 'Microsoft Edge'],
	['microsoft edge', 'Microsoft Edge'],
	['comet', 'Comet'],
	['finder', 'Finder'],
	['system settings', 'System Settings'],
	['settings', 'System Settings'],
	['activity monitor', 'Activity Monitor'],
	['console', 'Console'],
	['disk utility', 'Disk Utility'],
	['system information', 'System Information'],
	['visual studio code', 'Visual Studio Code'],
	['code', 'Visual Studio Code'],
	['cursor', 'Cursor'],
	['zed', 'Zed'],
	['sublime text', 'Sublime Text'],
	['nova', 'Nova'],
	['notes', 'Notes'],
	['textedit', 'TextEdit'],
	['text edit', 'TextEdit'],
	['terminal', 'Terminal'],
]);

const URL_RE = /(?:https?:\/\/)?(?:www\.)?[\w.-]+\.[a-z]{2,}(?:\/[^\s]*)?/i;

function collapseWhitespace(value) {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectAppName(text = '') {
	const lower = text.toLowerCase();
	for (const [alias, canonical] of APP_ALIASES.entries()) {
		const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		if (pattern.test(lower)) return canonical;
	}
	return null;
}

function extractUrl(text = '') {
	const match = String(text || '').match(URL_RE);
	return match ? normalizeUrl(match[0]) : '';
}

function splitClauses(goal = '') {
	return String(goal || '')
		.replace(/\s*,\s*/g, ' and ')
		.split(/\b(?:and then|then|and)\b/i)
		.map((part) => collapseWhitespace(part))
		.filter(Boolean);
}

function cleanupTargetText(text = '') {
	return collapseWhitespace(
		String(text || '')
			.replace(/^(?:the|to)\s+/i, '')
			.replace(/\s+(?:on|in)\s+the\s+current\s+.+$/i, '')
			.replace(/\s+(?:on|in)\s+this\s+.+$/i, '')
			.replace(/\s+from\s+the\s+search\s+result(?:s)?$/i, '')
			.replace(/\b(?:tab|button|link|page|item|entry|folder|file|channel|profile)\b$/i, '')
	);
}

function normalizeSearchQuery(text = '') {
	return collapseWhitespace(
		String(text || '')
			.replace(/^(?:on|in)\s+youtube\s+/i, '')
			.replace(/^youtube\s+(?:channel|channels|video|videos|short|shorts)\s+/i, '')
			.replace(/^youtube\s+(?:search\s+)?(?:for\s+)?/i, '')
			.replace(/^for\s+/i, '')
			.replace(/\s+(?:on|in)\s+youtube$/i, '')
	);
}

function parseTypeClause(clause, appHint) {
	const typeMatch = clause.match(/^(?:type|enter|write)\s+["“]?(.+?)["”]?(?:\s+(?:into|in|on)\s+(.+))?$/i);
	if (!typeMatch) return null;
	const value = collapseWhitespace(typeMatch[1]);
	const target = cleanupTargetText(typeMatch[2] || '');
	return {
		type: 'setElementValue',
		appHint,
		value,
		selector: target ? { text: target, exact: false, role: 'text field' } : null,
	};
}

function parseSearchClause(clause, appHint) {
	const searchMatch = clause.match(/^(?:search(?:\s+for)?|find)\s+["“]?(.+?)["”]?$/i);
	if (!searchMatch) return null;
	const query = normalizeSearchQuery(searchMatch[1]);
	if (!query) return null;
	return {
		type: 'searchInCurrentContext',
		appHint,
		query,
	};
}

function parseSearchResultClause(clause, appHint) {
	const match = clause.match(/^click\s+(?:the\s+)?first\s+channel(?:\s+(?:result|from the search result|profile))?\.?$/i);
	if (!match) return null;
	return {
		type: 'clickSearchResult',
		appHint,
		resultKind: 'channel',
		position: 1,
	};
}

function parseScrollClause(clause, appHint) {
	const match = clause.match(/^scroll\s+(up|down)(?:\s+until\s+(.+))?$/i);
	if (!match) return null;
	const target = cleanupTargetText(match[2] || '');
	return {
		type: 'scrollUntilVisible',
		appHint,
		direction: match[1].toLowerCase(),
		selector: target ? { text: target, exact: false } : null,
	};
}

function parseHistoryNavigationClause(clause, appHint) {
	const match = clause.match(/^(?:go\s+)?(back|forward)(?:\s+in(?:\s+the)?\s+(?:browser\s+)?history)?(?:\s+in\s+.+)?\.?$/i);
	if (!match) return null;
	return {
		type: 'navigateHistory',
		appHint,
		direction: match[1].toLowerCase(),
	};
}

function parseMediaControlClause(clause, appHint) {
	const match = clause.match(/^(pause|play|resume)(?:\s+(?:the\s+)?(?:currently\s+)?playing\s+(?:video|media|audio))?(?:\s+in\s+.+)?\.?$/i);
	if (!match) return null;
	return {
		type: 'mediaControl',
		appHint,
		action: /^(play|resume)$/i.test(match[1]) ? 'play' : 'pause',
	};
}

function parseEditorCommandClause(clause, appHint) {
	const normalized = collapseWhitespace(clause);
	const commands = [
		{ pattern: /^(?:save|save file|save this file)$/i, action: 'save', key: 'cmd+s' },
		{ pattern: /^(?:undo)$/i, action: 'undo', key: 'cmd+z' },
		{ pattern: /^(?:redo)$/i, action: 'redo', key: 'cmd+shift+z' },
		{ pattern: /^(?:find|search in file)$/i, action: 'find', key: 'cmd+f' },
		{ pattern: /^(?:new file)$/i, action: 'newFile', key: 'cmd+n' },
		{ pattern: /^(?:copy)$/i, action: 'copy', key: 'cmd+c' },
		{ pattern: /^(?:cut)$/i, action: 'cut', key: 'cmd+x' },
		{ pattern: /^(?:paste)$/i, action: 'paste', key: 'cmd+v' },
		{ pattern: /^(?:select all)$/i, action: 'selectAll', key: 'cmd+a' },
		{ pattern: /^(?:close file|close tab)$/i, action: 'closeFile', key: 'cmd+w' },
	];
	for (const command of commands) {
		if (command.pattern.test(normalized)) {
			return {
				type: 'editorCommand',
				appHint,
				action: command.action,
				key: command.key,
			};
		}
	}
	return null;
}

function parseSystemQueryClause(clause, appHint) {
	const normalized = collapseWhitespace(clause);
	if (/^(?:check|show|what is|whats|what's)\s+(?:my\s+)?default\s+browser(?:\s+app)?$/i.test(normalized)) {
		return {
			type: 'resolveSystemDefault',
			appHint: appHint || 'System Settings',
			kind: 'browser',
		};
	}
	if (/^(?:check|show|what is|whats|what's)\s+(?:my\s+)?default\s+mail(?:\s+app)?$/i.test(normalized)) {
		return {
			type: 'resolveSystemDefault',
			appHint: appHint || 'System Settings',
			kind: 'mail',
		};
	}
	return null;
}

function parseNavigationClause(clause, appHint) {
	const lower = clause.toLowerCase();
	const url = extractUrl(clause);
	if (/^(?:go to|visit|navigate to|open)\b/i.test(lower) && url) {
		return { type: 'openUrl', appHint, url };
	}
	if (/^(?:go to|visit|navigate to)\b/i.test(lower)) {
		const target = cleanupTargetText(clause.replace(/^(?:go to|visit|navigate to)\s+/i, ''));
		if (!target) return null;
		return {
			type: 'clickElement',
			appHint,
			selector: { text: target, exact: false },
		};
	}
	return null;
}

function parseSelectionClause(clause, appHint) {
	const clickMatch = clause.match(/^(?:click|open|select)\s+(.+)$/i);
	if (!clickMatch) return null;
	const target = cleanupTargetText(clickMatch[1]);
	if (!target) return null;
	return {
		type: /^select\b/i.test(clause) ? 'selectItemByText' : 'clickElement',
		appHint,
		selector: { text: target, exact: false },
	};
}

function parseInstallCleanupClause(clause, appHint) {
	const match = clause.match(/^(clean(?:\s+up)?|remove|delete|trash|eject|detach)\s+(.+)$/i);
	if (!match) return null;
	const action = match[1].toLowerCase();
	const target = cleanupTargetText(match[2] || '');
	if (!target) return null;
	if (!/\b(dmg|disk image|installer|install file|pkg|package|mounted volume|volume)\b/i.test(target)) {
		return null;
	}
	return {
		type: 'cleanupInstallArtifact',
		appHint: appHint || 'Finder',
		action,
		target,
	};
}

function parseOpenClause(clause, appHint, steps) {
	const lower = clause.toLowerCase();
	if (!/^(?:open|launch|start)\b/i.test(lower)) return null;
	if (/\bdefault browser\b/i.test(clause)) {
		return [{ type: 'openApp', appName: 'default browser' }];
	}
	if (/\bdefault mail(?: app)?\b/i.test(clause)) {
		return [{ type: 'openApp', appName: 'default mail' }];
	}
	const appName = detectAppName(clause);
	const url = extractUrl(clause);
	const parsed = [];
	if (appName && !steps.some((step) => step.type === 'openApp' && step.appName === appName)) {
		parsed.push({ type: 'openApp', appName });
	}
	if (url) {
		parsed.push({ type: 'openUrl', appHint: appName || appHint, url });
	}
	return parsed.length ? parsed : null;
}

function routeGoal(goal, explicitAppHint = '') {
	const appHint = detectAppName(explicitAppHint) || detectAppName(goal) || '';
	const clauses = splitClauses(goal);
	const steps = [];

	for (const clause of clauses) {
		const openSteps = parseOpenClause(clause, appHint, steps);
		if (openSteps) {
			steps.push(...openSteps);
			continue;
		}

		const navigation = parseNavigationClause(clause, appHint);
		if (navigation) {
			steps.push(navigation);
			continue;
		}

		const typeStep = parseTypeClause(clause, appHint);
		if (typeStep) {
			steps.push(typeStep);
			continue;
		}

		const historyStep = parseHistoryNavigationClause(clause, appHint);
		if (historyStep) {
			steps.push(historyStep);
			continue;
		}

		const mediaControlStep = parseMediaControlClause(clause, appHint);
		if (mediaControlStep) {
			steps.push(mediaControlStep);
			continue;
		}

		const editorCommandStep = parseEditorCommandClause(clause, appHint);
		if (editorCommandStep) {
			steps.push(editorCommandStep);
			continue;
		}

		const systemQueryStep = parseSystemQueryClause(clause, appHint);
		if (systemQueryStep) {
			steps.push(systemQueryStep);
			continue;
		}

		const searchStep = parseSearchClause(clause, appHint);
		if (searchStep) {
			steps.push(searchStep);
			continue;
		}

		const resultStep = parseSearchResultClause(clause, appHint);
		if (resultStep) {
			steps.push(resultStep);
			continue;
		}

		const installCleanupStep = parseInstallCleanupClause(clause, appHint);
		if (installCleanupStep) {
			steps.push(installCleanupStep);
			continue;
		}

		const selection = parseSelectionClause(clause, appHint);
		if (selection) {
			steps.push(selection);
			continue;
		}

		const scrollStep = parseScrollClause(clause, appHint);
		if (scrollStep) {
			steps.push(scrollStep);
			continue;
		}
	}

	return {
		goal: collapseWhitespace(goal),
		appHint,
		steps,
		confidence: steps.length ? 0.9 : 0,
	};
}

module.exports = {
	APP_ALIASES,
	detectAppName,
	extractUrl,
	parseHistoryNavigationClause,
	parseMediaControlClause,
	parseEditorCommandClause,
	parseSystemQueryClause,
	parseSearchClause,
	parseSearchResultClause,
	parseInstallCleanupClause,
	normalizeSearchQuery,
	routeGoal,
	splitClauses,
};
