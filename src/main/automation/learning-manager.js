const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../../shared/config').default;
const { LearningClassifier } = require('./learning-classifier');
const log = require('../logger');
const { inferDomain } = require('./skill-policy');

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
	return new Date().toISOString();
}

function normalizeText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hash(value = '') {
	return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function normalizeIssueText(value = '') {
	return String(value || '')
		.toLowerCase()
		.replace(/<noise>/g, ' ')
		.replace(/https?:\/\/\S+/g, '<url>')
		.replace(/["'`]/g, '')
		.replace(/\b\d+\b/g, '<num>')
		.replace(/\s+/g, ' ')
		.trim();
}

const ISSUE_STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'at',
	'current',
	'currently',
	'for',
	'from',
	'i',
	'in',
	'is',
	'it',
	'me',
	'my',
	'of',
	'on',
	'or',
	'please',
	'that',
	'the',
	'this',
	'to',
	'what',
	'with',
]);

const ISSUE_TOKEN_MAP = new Map([
	['application', 'app'],
	['applications', 'app'],
	['apps', 'app'],
	['browsers', 'browser'],
	['channels', 'channel'],
	['clicked', 'click'],
	['clicking', 'click'],
	['closed', 'close'],
	['closing', 'close'],
	['copied', 'copy'],
	['copying', 'copy'],
	['cutting', 'cut'],
	['directories', 'folder'],
	['directory', 'folder'],
	['documents', 'document'],
	['editors', 'editor'],
	['email', 'mail'],
	['files', 'file'],
	['folders', 'folder'],
	['found', 'find'],
	['launched', 'activate'],
	['launching', 'activate'],
	['opened', 'open'],
	['opening', 'open'],
	['icons', 'icon'],
	['pasted', 'paste'],
	['pasting', 'paste'],
	['preferences', 'settings'],
	['queried', 'query'],
	['querying', 'query'],
	['results', 'result'],
	['screens', 'screen'],
	['seeing', 'see'],
	['saved', 'save'],
	['saving', 'save'],
	['searched', 'search'],
	['searching', 'search'],
	['selected', 'select'],
	['selecting', 'select'],
	['tabs', 'tab'],
	['utilities', 'utility'],
	['videos', 'video'],
	['vscode', 'vscode'],
	['windows', 'window'],
]);

const GENERIC_ACTION_TOKENS = new Set([
	'activate',
	'click',
	'close',
	'copy',
	'cut',
	'find',
	'navigate',
	'open',
	'paste',
	'pause',
	'play',
	'query',
	'redo',
	'resolve',
	'save',
	'search',
	'select',
	'undo',
]);

const APP_HINT_TOKENS = new Set([
	'arc',
	'chrome',
	'console',
	'cursor',
	'finder',
	'safari',
	'settings',
	'system',
	'textedit',
	'utility',
	'vscode',
	'youtube',
	'zed',
]);

const RECENT_SELF_FIX_COOLDOWN_MS = 30 * 1000;

function canonicalizeIssueText(value = '') {
	return normalizeIssueText(value)
		.replace(/(হোয়াট|হোয়াট|ह्वाट|व्हाट|वाट)\s+(আর|आर|आर)\s+(ইউ|यू)\s+(ডুইং|ডूইং|डुइंग|डूइंग)/g, 'what are you doing')
		.replace(/(হোয়াটস|হোয়াটস|व्हाट्स|व्हाट)\s+(ডান|ডোন|डन|डोन)\s+(অলরেডি|আলরেডি|अलरेडी|ऑलरेडी)/g, 'whats done already')
		.replace(/\bkeep self[- ]?verifying\b/g, 'self_verify')
		.replace(/\bself[- ]?verif(?:y|ying)\b/g, 'self_verify')
		.replace(/\bverify your(?:self| work)\b/g, 'self_verify')
		.replace(/\bcheck your own work\b/g, 'self_verify')
		.replace(/\bgiv(?:e|ing) yourself input\b/g, 'self_input')
		.replace(/\bfeed yourself input\b/g, 'self_input')
		.replace(/\bgenerate your own (?:next )?input\b/g, 'self_input')
		.replace(/\bdecide the next step yourself\b/g, 'self_input')
		.replace(/\bkeep working on it\b/g, 'autonomous_continuation')
		.replace(/\bcontinue working\b/g, 'autonomous_continuation')
		.replace(/\bkeep going\b/g, 'autonomous_continuation')
		.replace(/\buntil i get back\b/g, 'autonomous_continuation')
		.replace(/\bwhile im away\b/g, 'autonomous_continuation')
		.replace(/\bwhile i'm away\b/g, 'autonomous_continuation')
		.replace(/\bnow do you see a battery icon in the status bar\b/g, 'status_bar battery_icon')
		.replace(/\bdo you see a battery icon in the status bar\b/g, 'status_bar battery_icon')
		.replace(/\bcan you see a battery icon in the status bar\b/g, 'status_bar battery_icon')
		.replace(/\bbattery icon in the status bar\b/g, 'status_bar battery_icon')
		.replace(/\bbattery icon in the menu bar\b/g, 'status_bar battery_icon')
		.replace(/\bstatus bar\b/g, 'status_bar')
		.replace(/\bmenu bar\b/g, 'status_bar')
		.replace(/\bbattery icon\b/g, 'battery_icon')
		.replace(/\bdo you see the focus toggle\b/g, 'screen_reference visible_target focus_toggle')
		.replace(/\bcan you see the focus toggle\b/g, 'screen_reference visible_target focus_toggle')
		.replace(/\bfocus mode toggle\b/g, 'focus_toggle')
		.replace(/\bfocus toggle\b/g, 'focus_toggle')
		.replace(/\bcan you see my screen\b/g, 'screen_reference')
		.replace(/\bcan you see the screen\b/g, 'screen_reference')
		.replace(/\bdo you see my screen\b/g, 'screen_reference')
		.replace(/\bdo you see the screen\b/g, 'screen_reference')
		.replace(/\blook at my screen\b/g, 'screen_reference')
		.replace(/\blook at the screen\b/g, 'screen_reference')
		.replace(/\bon my screen\b/g, 'screen_reference')
		.replace(/\bclick where i told you(?: to)?\b/g, 'click visible_target')
		.replace(/\bclick where i pointed\b/g, 'click visible_target')
		.replace(/\bclick there\b/g, 'click visible_target')
		.replace(/\bclick here\b/g, 'click visible_target')
		.replace(/\bclick that one\b/g, 'click visible_target')
		.replace(/\bclick this one\b/g, 'click visible_target')
		.replace(/\bopen that\b/g, 'open visible_target')
		.replace(/\bopen this\b/g, 'open visible_target')
		.replace(/\bthat one\b/g, 'visible_target')
		.replace(/\bthis one\b/g, 'visible_target')
		.replace(/\bgo to\b/g, 'open')
		.replace(/\bgo back\b/g, 'navigate back')
		.replace(/\b(verif\w*|check|confirm(?:ation|ed)?|validated?)\b/g, 'self_verify')
		.replace(/\b(outdated|stale|old)\s+(screen|screenshot|capture|image)s?\b/g, 'stale_screen')
		.replace(/\b(screen|screenshot|capture|image)s?\s+(are\s+)?(outdated|stale|old)\b/g, 'stale_screen')
		.replace(/\byou say you did\b/g, 'unverified_action_claim')
		.replace(/\byou said you did\b/g, 'unverified_action_claim')
		.replace(/\bsay you clicked\b/g, 'unverified_action_claim')
		.replace(/\bsay you opened\b/g, 'unverified_action_claim')
		.replace(/\bsay you went\b/g, 'unverified_action_claim')
		.replace(/\balready went to that page\b/g, 'unverified_navigation_claim')
		.replace(/\b(?:have not|havent|haven't|not)\s+actually gone to that page\b/g, 'unverified_navigation_claim')
		.replace(/\bbefore you (?:tap|click|say|claim|report)\b/g, 'pre_action_verification')
		.replace(/\bdefault browser\b/g, 'default_browser')
		.replace(/\bdefault mail\b/g, 'default_mail')
		.replace(/\bdefault app\b/g, 'default_app')
		.replace(/\bchannel link\b/g, 'channel_link')
		.replace(/\bchannel result\b/g, 'channel_result')
		.replace(/\bsystem settings\b/g, 'system_settings')
		.replace(/\bvisual studio code\b/g, 'vscode');
}

function inferAutonomousSelfImprovementPolicy(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return null;
	const asksForNextSelfImprovementStep = /\b(what else do you have to do(?: after that)?|what do you have to do after that|what else is left(?: after that)?|what else remains(?: after that)?)\b/.test(normalized);
	const mentionsSelfImprovement = /\b(self improve|self-improve|self improvement|self-improvement|improve yourself)\b/.test(normalized);
	if (!asksForNextSelfImprovementStep || !mentionsSelfImprovement) return null;
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.autonomous_self_drive',
		value: {
			enabled: true,
			message: 'After each self-fix, partial success, or verification result, determine the next improvement step yourself and keep iterating until the underlying friction is removed. Do not ask the user what to do next when the next self-improvement action can be inferred from the current result.',
			evidence: String(text || '').trim(),
		},
		source: 'user_correction',
		confidence: 0.96,
		evidence: text,
	};
}

function inferDirectCreativeFulfillmentPolicy(text = '') {
	const raw = String(text || '').trim();
	if (!raw) return null;
	const normalized = normalizeText(raw);
	if (!normalized) return null;
	const asksForPoem = /\b(?:tell|write|say|make|compose|give)\s+me\s+(?:a\s+)?poem\b/.test(normalized)
		|| /\bpoem\b/.test(normalized)
		|| /टेल\s+मी\s+(?:अ\s+)?पोय[म]|टेल\s+मी\s+(?:ए\s+)?पोय[म]/i.test(raw);
	const asksForOtherCreative = /\b(?:tell|write|say|make|give)\s+me\s+(?:a\s+)?(?:joke|caption|story)\b/.test(normalized);
	if (!asksForPoem && !asksForOtherCreative) return null;
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.direct_creative_fulfillment',
		value: {
			enabled: true,
			message: 'When the user makes a short casual creative request such as asking for a poem, joke, caption, or short story, fulfill it directly instead of asking for task clarification or workspace context. Treat brief transliterated variants like "tell me a poem" as the same request when the intent is clear.',
			evidence: raw,
		},
		source: 'user_correction',
		confidence: 0.96,
		evidence: raw,
	};
}

function inferCapabilityOverviewFulfillmentPolicy(text = '') {
	const raw = String(text || '').trim();
	if (!raw) return null;
	const normalized = normalizeText(raw);
	if (!normalized) return null;
	const asksBroadCapability = /\bwhat can you do\b/.test(normalized);
	const asksCapabilityForMe = /\bwhat can you do for me\b/.test(normalized);
	const asksHelpForMe = /\bwhat can you help me with\b/.test(normalized);
	const mentionsCapabilityMeta = /\b(capabilit(?:y|ies)|help with|help me with|instead of|rather than|do not ask|don't ask|dont ask)\b/.test(normalized);
	if (!(asksBroadCapability && asksCapabilityForMe) && !(asksBroadCapability && mentionsCapabilityMeta) && !asksHelpForMe) return null;
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.capability_overview_fulfillment',
		value: {
			enabled: true,
			message: 'When the user asks a broad capability question such as "what can you do" or "what can you do for me", answer directly with a concise overview of how you can help, tailored to the current context when relevant, instead of bouncing to task clarification, workspace context, or project selection.',
			evidence: raw,
		},
		source: 'user_correction',
		confidence: 0.96,
		evidence: raw,
	};
}

function inferPartialTurnBackgroundPolicy(text = '') {
	const raw = String(text || '').trim();
	if (!raw) return null;
	const normalized = normalizeText(raw);
	if (!normalized) return null;
	if (!/\b(do nothing with that|it was incomplete|that was incomplete|ignore that|dont do anything with that|don't do anything with that)\b/.test(normalized)) {
		return null;
	}
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.partial_turn_background_handling',
		value: {
			enabled: true,
			message: 'When a user indicates their previous utterance was incomplete or should be ignored, do not interrogate them about it and do not trigger foreground recovery chatter. Treat it as background conversational noise and wait for the next complete turn.',
			evidence: raw,
		},
		source: 'user_correction',
		confidence: 0.97,
		evidence: raw,
	};
}

function tokenizeIssueText(value = '') {
	return canonicalizeIssueText(value)
		.split(/[^a-z0-9_]+/)
		.filter(Boolean)
		.map((token) => ISSUE_TOKEN_MAP.get(token) || token)
		.filter((token) => !ISSUE_STOP_WORDS.has(token));
}

function uniqueSorted(values = []) {
	return [...new Set(values.filter(Boolean))].sort();
}

function toolFamily(toolName = '') {
	const name = String(toolName || '');
	if (['click_at', 'double_click', 'mouse_move', 'drag'].includes(name)) return 'pointer';
	if (name === 'run_ui_task') return 'planner';
	if (['open_app', 'get_default_app', 'window_manage', 'finder_open_item', 'finder_select_item'].includes(name)) return 'native';
	if (['type_text', 'press_key', 'scroll'].includes(name)) return 'ax_dom';
	return name ? 'general' : '';
}

function deriveIntentFamily(text, tokenSet, domain) {
	if (text.includes('autonomous_continuation') || tokenSet.has('self_input')) return 'autonomous_continuation';
	if (tokenSet.has('self_verify') && (text.includes('autonomous_continuation') || tokenSet.has('self_input'))) return 'autonomous_continuation';
	if (/\bwhat are you doing\b/.test(text) || /\bwhats done already\b/.test(text) || /\bwhat(?:'s| is)? the status\b/.test(text) || /\bprogress update\b/.test(text)) {
		return 'progress_accountability';
	}
	if (text.includes('stale_screen') || text.includes('unverified_action_claim') || text.includes('unverified_navigation_claim') || text.includes('pre_action_verification')) return 'action_verification';
	if (text.includes('status_bar') && (text.includes('battery_icon') || tokenSet.has('icon'))) return 'status_bar_icon';
	if (text.includes('screen_reference') || tokenSet.has('screen')) return 'screen_reference';
	if (text.includes('default_browser') || text.includes('default_mail') || text.includes('default_app')) return 'resolve_default';
	if (tokenSet.has('pause') || tokenSet.has('play') || tokenSet.has('video')) return 'media_control';
	if (tokenSet.has('save') || tokenSet.has('undo') || tokenSet.has('redo') || tokenSet.has('copy') || tokenSet.has('paste') || tokenSet.has('cut') || tokenSet.has('find') || tokenSet.has('close')) {
		return 'editor_command';
	}
	if (domain === 'finder' || tokenSet.has('finder') || tokenSet.has('file') || tokenSet.has('folder')) return 'file_navigation';
	if (tokenSet.has('system') || tokenSet.has('settings') || tokenSet.has('utility')) return 'system_query';
	if (tokenSet.has('search') || tokenSet.has('query')) return 'search';
	if (tokenSet.has('activate')) return 'activation';
	if (tokenSet.has('open') || tokenSet.has('click') || tokenSet.has('select') || tokenSet.has('navigate') || tokenSet.has('link') || tokenSet.has('result')) return 'navigation';
	return domain || 'structural_gap';
}

function deriveTargetFeatures(text, tokenSet, domain) {
	const targets = [];
	if (text.includes('what are you doing') || text.includes('whats done already') || tokenSet.has('status') || tokenSet.has('progress')) {
		targets.push('active_work_context');
	}
	if (text.includes('self_verify') || tokenSet.has('self_verify')) targets.push('self_verification');
	if (text.includes('self_input') || tokenSet.has('self_input')) targets.push('self_directed_input');
	if (text.includes('status_bar') || (tokenSet.has('status') && tokenSet.has('bar'))) targets.push('status_bar');
	if (text.includes('battery_icon') || (tokenSet.has('battery') && tokenSet.has('icon'))) targets.push('battery_icon');
	if (text.includes('screen_reference') || tokenSet.has('screen')) targets.push('screen_context');
	if (text.includes('stale_screen') || tokenSet.has('stale_screen')) targets.push('screen_context');
	if (text.includes('visible_target') || (tokenSet.has('there') && tokenSet.has('click')) || (tokenSet.has('here') && tokenSet.has('click'))) {
		targets.push('visible_target');
	}
	if (text.includes('focus_toggle') || tokenSet.has('focus_toggle') || (tokenSet.has('focus') && tokenSet.has('toggle'))) {
		targets.push('focus_toggle');
	}
	if (text.includes('default_browser')) targets.push('default_browser');
	if (text.includes('default_mail')) targets.push('default_mail');
	if (text.includes('channel_link') || text.includes('channel_result') || (tokenSet.has('channel') && (tokenSet.has('link') || tokenSet.has('result')))) {
		targets.push('channel_result');
	}
	if (tokenSet.has('video')) targets.push('video');
	if (tokenSet.has('file') || tokenSet.has('folder') || domain === 'finder') targets.push('file_target');
	if (tokenSet.has('tab')) targets.push('tab');
	if (tokenSet.has('settings')) targets.push('settings');
	if (tokenSet.has('browser')) targets.push('browser');
	if (tokenSet.has('editor') || tokenSet.has('vscode') || tokenSet.has('cursor') || tokenSet.has('zed') || tokenSet.has('textedit')) targets.push('editor');
	if (tokenSet.has('system') || tokenSet.has('utility')) targets.push('system');
	return uniqueSorted(targets);
}

function deriveAppFeatures(tokenSet) {
	return uniqueSorted([...tokenSet].filter((token) => APP_HINT_TOKENS.has(token)));
}

function deriveEntityFeatures(tokens = [], targets = [], apps = []) {
	return uniqueSorted(
		tokens.filter((token) => {
			if (GENERIC_ACTION_TOKENS.has(token)) return false;
			if (APP_HINT_TOKENS.has(token)) return false;
			if (token === 'noise') return false;
			if (targets.includes(token)) return false;
			if (apps.includes(token)) return false;
			return token.length > 2;
		}).slice(0, 6)
	);
}

function countAsciiTokens(tokens = []) {
	return tokens.filter((token) => /^[a-z0-9_]+$/.test(token)).length;
}

function countRawTerms(value = '') {
	return String(value || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

function hasNonAsciiLetters(value = '') {
	return /[^\x00-\x7f]/.test(String(value || ''));
}

function inferNoisyPointerVisibleTarget({ rawText = '', text = '', tokenSet, pointerMode = 'nonpointer', targets = [] } = {}) {
	if (pointerMode !== 'pointer') return false;
	if (targets.length) return false;
	if (!hasNonAsciiLetters(rawText)) return false;
	const asciiTokens = countAsciiTokens([...tokenSet]);
	if (/<noise>/i.test(String(rawText || '')) || /\bnoise\b/.test(text)) {
		return asciiTokens <= 1;
	}
	const rawTerms = countRawTerms(rawText);
	return rawTerms > 0 && rawTerms <= 4 && asciiTokens === 0;
}

function inferNoisyPointerScreenReference({ rawText = '', tokenSet, pointerMode = 'nonpointer', targets = [] } = {}) {
	if (pointerMode !== 'pointer') return false;
	if (targets.includes('screen_context')) return false;
	if (!hasNonAsciiLetters(rawText)) return false;
	if (!tokenSet.has('screen')) return false;
	const rawTerms = countRawTerms(rawText);
	if (rawTerms === 0 || rawTerms > 6) return false;
	const asciiTokens = countAsciiTokens([...tokenSet]);
	return asciiTokens <= 1;
}

function inferFlattenedPreparationRecoveryPolicy(event = {}) {
	const rawText = String(
		event.guidanceText
		|| event.userText
		|| event.classification?.payload?.description
		|| event.issueSignature
		|| ''
	).trim();
	if (!rawText) return null;
	const normalized = normalizeText(rawText);
	if (!normalized) return null;
	const mentionsPlanner = normalized.includes('run_ui_task');
	const mentionsOpenApp = normalized.includes('open_app');
	const mentionsPointer = /\b(click_at|double_click|mouse_move|drag)\b/.test(normalized);
	const mentionsRecovery = /\brecover(?:ed|y|ies|ing)?\b/.test(normalized)
		|| /\bafter user guidance\b/.test(normalized)
		|| /\bto open_app\b/.test(normalized);
	if (!mentionsPlanner || !mentionsOpenApp || !mentionsPointer || !mentionsRecovery) return null;
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.pre_click_preparation',
		value: {
			enabled: true,
			message: 'When a UI task depends on a specific app or window, open or focus that app first, refresh the screen context, and only then use pointer actions or resolve visible targets. Treat run_ui_task -> open_app recovery as missing preparation rather than a reason to ask for the same guidance again.',
			evidence: rawText,
		},
		source: 'observed_recovery',
		confidence: 0.96,
		evidence: rawText,
	};
}

const POINTER_SEQUENCE_TOOLS = new Set(['click_at', 'double_click', 'mouse_move', 'drag']);

class LearningManager {
	constructor({ memoryStore, selfImprovementManager, selfFixTool = null, irisDir = config.paths.irisDir } = {}) {
		this.memoryStore = memoryStore;
		this.selfImprovementManager = selfImprovementManager;
		this.selfFixTool = selfFixTool || require('../tools/self-fix').self_fix;
		this.classifier = new LearningClassifier();
		this.irisDir = irisDir;
		this.logPath = path.join(this.irisDir, 'learning_log.json');
		this.issuePath = path.join(this.irisDir, 'self_fix_issues.json');
		ensureDir(this.irisDir);
		this.queue = [];
		this.processing = false;
		this.recentTurns = [];
		this.recentToolExecutions = [];
		this.activeIssues = new Set();
		this.deferredIssueQueue = [];
		this.activeSelfFixCount = 0;
		this._ensureFiles();
	}

	_ensureFiles() {
		if (!fs.existsSync(this.logPath)) {
			fs.writeFileSync(this.logPath, JSON.stringify({ version: 1, updatedAt: nowIso(), events: [] }, null, 2), 'utf8');
		}
		if (!fs.existsSync(this.issuePath)) {
			fs.writeFileSync(this.issuePath, JSON.stringify({ version: 1, updatedAt: nowIso(), issues: [] }, null, 2), 'utf8');
		}
	}

	_readJson(filePath, fallback) {
		try {
			return JSON.parse(fs.readFileSync(filePath, 'utf8'));
		} catch {
			return fallback;
		}
	}

	_writeJson(filePath, data) {
		data.updatedAt = nowIso();
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
	}

	recordConversationTurn(role, text) {
		const turn = {
			id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			role,
			text: String(text || ''),
			createdAt: nowIso(),
		};
		this.recentTurns.push(turn);
		if (this.recentTurns.length > 20) this.recentTurns.shift();
		if (role !== 'user') return;

		const classification = this.classifier.classifyConversation(text, {
			recentToolExecutions: this.recentToolExecutions,
			recentTurns: this.recentTurns,
		});
		if (classification) {
			log.info('Learning', `Detected conversation learning event: type=${classification.type} reason=${classification.reason || 'n/a'} text=${String(text || '').slice(0, 140)}`);
			this.enqueue({
				type: classification.type,
				backgroundOnly: classification.type === 'core-gap' && classification.reason === 'generic user correction',
				domain: inferDomain(text),
				issueSignature: classification.payload?.issueSignature || classification.key,
				userText: text,
				guidanceText: text,
				classification,
				failedTools: this.recentToolExecutions.filter((item) => item.success === false).slice(-4),
				successfulTools: this.recentToolExecutions.filter((item) => item.success !== false).slice(-4),
				createdAt: nowIso(),
			});
		} else {
			// Regex found nothing — try LLM-based classification for ambiguous cases
			this._tryLlmClassification(text).catch((err) => {
				log.error('Learning', `LLM classification failed: ${err?.message || err}`);
			});
		}
	}

	async _tryLlmClassification(text) {
		const { getIntentPredictionEngine } = require('./service-ref');
		const intentEngine = getIntentPredictionEngine();
		if (!intentEngine?.available) return;

		const recentTools = this.recentToolExecutions.slice(-10).map((t) => ({
			name: t.name, success: t.success !== false, durationMs: Number(t.durationMs || 0),
		}));
		const recentTurns = this.recentTurns.slice(-5).map((t) => ({
			role: t.role, text: String(t.text || '').slice(0, 200),
		}));

		const classification = await intentEngine.classifyText(text, { recentTools, recentTurns });
		if (!classification) return;

		log.info('Learning', `LLM classified conversation: type=${classification.type} reason=${classification.reason || 'n/a'} text=${String(text || '').slice(0, 140)}`);
		this.enqueue({
			type: classification.type,
			backgroundOnly: false,
			domain: inferDomain(text),
			issueSignature: classification.key,
			userText: text,
			guidanceText: text,
			classification,
			failedTools: this.recentToolExecutions.filter((item) => item.success === false).slice(-4),
			successfulTools: this.recentToolExecutions.filter((item) => item.success !== false).slice(-4),
			createdAt: nowIso(),
		});
	}

	recordToolExecution(name, args, result, success, durationMs) {
		const event = {
			id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name,
			args: args || {},
			result: String(result || ''),
			success: success !== false,
			durationMs: Number(durationMs || 0),
			createdAt: nowIso(),
		};
		this.recentToolExecutions.push(event);
		if (this.recentToolExecutions.length > 40) this.recentToolExecutions.shift();

		if (!event.success) return;

		const latestUserText = [...this.recentTurns].reverse().find((turn) => turn.role === 'user')?.text || '';
		const failedTools = this.recentToolExecutions.filter((item) => item.success === false).slice(-4);
		const successfulTools = this.recentToolExecutions.filter((item) => item.success !== false).slice(-4);
		const classification = this.classifier.classifyRecovery({ failedTools, successfulTools, latestUserText });
		if (!classification) return;
		log.info('Learning', `Detected tool recovery learning event: type=${classification.type} reason=${classification.reason || 'n/a'} failed=${failedTools.map((item) => item.name).join(',')} success=${successfulTools.map((item) => item.name).join(',')}`);

		this.enqueue({
			type: classification.type,
			domain: inferDomain(latestUserText || successfulTools.map((item) => item.name).join(' ')),
			issueSignature: classification.payload?.issueSignature || classification.key,
			userText: latestUserText,
			guidanceText: latestUserText,
			classification,
			failedTools,
			successfulTools,
			createdAt: nowIso(),
		});
	}

	resolveToolRequest(name, args = {}) {
		if (name === 'open_app') {
			const requested = normalizeText(args.name || '');
			if (requested.includes('default browser')) {
				const appName = this.memoryStore.getValue('environment.default_browser.app_name', '');
				if (appName) {
					log.info('Learning', `Resolved tool request from memory: ${args.name} -> ${appName}`);
					return { name, args: { ...args, name: appName, learned_from_memory: true } };
				}
			}
			if (requested.includes('default mail')) {
				const appName = this.memoryStore.getValue('environment.default_mail.app_name', '');
				if (appName) {
					log.info('Learning', `Resolved tool request from memory: ${args.name} -> ${appName}`);
					return { name, args: { ...args, name: appName, learned_from_memory: true } };
				}
			}
		}
		if (name === 'get_default_app') {
			const requested = normalizeText(args.kind || 'browser');
			const appName = this.memoryStore.getValue(
				requested === 'mail' ? 'environment.default_mail.app_name' : 'environment.default_browser.app_name',
				''
			);
			if (appName) {
				log.info('Learning', `Resolved default-app query from memory: kind=${requested} app=${appName}`);
				return {
					name,
					args: {
						...(args || {}),
						kind: requested,
						resolved_app_name: appName,
						learned_from_memory: true,
					},
				};
			}
		}

		const goal = args.goal || args.name || '';
		const appHint = args.app_hint || args.appHint || '';
		const learned = this.selfImprovementManager?.findMatchingSkill?.({ goal, appHint });
		const sequence = learned?.preferredExecutionPath?.sequence;
		if (!learned || !Array.isArray(sequence) || !sequence.length) return { name, args };
		if (sequence.some((step) => POINTER_SEQUENCE_TOOLS.has(step.name))) return { name, args };
		const [step, ...rest] = sequence;
		if (!step || step.name !== name) return { name, args };
		log.info('Learning', `Applying learned tool sequence: skill=${learned.id} tool=${name} length=${sequence.length}`);
		return {
			name,
			args: { ...(args || {}), ...(step.args || {}), learned_skill_id: learned.id },
			sequenceRemainder: rest,
		};
	}

	enqueue(event) {
		log.info('Learning', `Queued learning event: type=${event.type} issue=${event.issueSignature || 'n/a'}`);
		this.queue.push(event);
		this._appendLog(event);
		if (!this.processing) {
			this.processing = true;
			setTimeout(() => this._drainQueue(), 0);
		}
	}

	_appendLog(event) {
		const log = this._readJson(this.logPath, { version: 1, updatedAt: nowIso(), events: [] });
		const tierPath = [
			...(event.failedTools || []).map((item) => this._inferTier(item.name)),
			...(event.successfulTools || []).map((item) => this._inferTier(item.name)),
		];
		log.events.push({
			id: event.id || `evt_${hash(JSON.stringify(event))}`,
			sessionId: event.sessionId || 'local',
			turnId: event.turnId || null,
			domain: event.domain || inferDomain(event.userText || event.guidanceText || ''),
			userText: event.userText || '',
			failedTools: event.failedTools || [],
			successfulTools: event.successfulTools || [],
			guidanceText: event.guidanceText || '',
			classification: event.classification?.type || event.type || '',
			issueSignature: event.issueSignature || '',
			tierPath,
			createdAt: event.createdAt || nowIso(),
		});
		if (log.events.length > 200) log.events = log.events.slice(-200);
		this._writeJson(this.logPath, log);
	}

	_clusterIssue(event = {}) {
		const domain = event.domain || inferDomain(event.userText || event.guidanceText || '');
		const semanticText = event.classification?.payload?.semanticText || '';
		const rawText = event.guidanceText
			|| event.userText
			|| event.classification?.payload?.description
			|| event.issueSignature
			|| '';
		const clusteringText = semanticText ? `${semanticText} ${rawText}`.trim() : rawText;
		const text = canonicalizeIssueText(clusteringText);
		const tokens = tokenizeIssueText(clusteringText);
		const tokenSet = new Set(tokens);
		const failedFamilies = uniqueSorted((event.failedTools || []).map((item) => toolFamily(item.name)));
		const succeededFamilies = uniqueSorted((event.successfulTools || []).map((item) => toolFamily(item.name)));
		const pointerMode = failedFamilies.includes('pointer') || succeededFamilies.includes('pointer') ? 'pointer' : 'nonpointer';
		let intentFamily = deriveIntentFamily(text, tokenSet, domain);
		let targets = deriveTargetFeatures(text, tokenSet, domain);
		if (inferNoisyPointerScreenReference({ rawText, tokenSet, pointerMode, targets })) {
			intentFamily = 'screen_reference';
			targets = uniqueSorted([...targets, 'screen_context', 'visible_target']);
		}
		if (inferNoisyPointerVisibleTarget({ rawText, text, tokenSet, pointerMode, targets })) {
			intentFamily = 'navigation';
			targets = uniqueSorted([...targets, 'visible_target']);
		}
		const apps = deriveAppFeatures(tokenSet);
		const entities = deriveEntityFeatures(tokens, targets, apps);
		const entitySignature = targets.length || apps.length ? 'none' : (entities.join('+') || 'none');
		const family = event.type === 'stabilization_candidate'
			? 'stabilize'
			: event.type === 'skill'
				? 'skill'
				: event.type === 'false_positive_skill'
					? 'false_positive'
					: 'core_gap';
		return {
			signature: [
				family,
				domain || 'general',
				intentFamily || 'general',
				targets.join('+') || 'none',
				apps.join('+') || 'none',
				entitySignature,
				pointerMode,
			].join(':').slice(0, 280),
			domain,
			canonicalDescription: normalizeIssueText(rawText) || `${intentFamily} ${targets.join(' ')}`.trim() || 'structural gap',
			semanticFeatures: {
				intentFamily,
				targets,
				apps,
				entities,
				failedToolFamilies: failedFamilies,
				successfulToolFamilies: succeededFamilies,
			},
		};
	}

	_getSelfFixConcurrencyLimit() {
		return Math.max(1, Math.min(3, this.queue.length + 1));
	}

	_enqueueDeferredIssue(issueSignature, event) {
		if (this.deferredIssueQueue.some((item) => item.issueSignature === issueSignature)) return;
		this.deferredIssueQueue.push({
			issueSignature,
			event,
		});
	}

	_pumpDeferredIssues() {
		if (!this.deferredIssueQueue.length) return;
		const next = this.deferredIssueQueue.shift();
		if (!next) return;
		setTimeout(() => {
			this.enqueue({
				...next.event,
				forceImmediate: true,
			});
		}, 0);
	}

	_inferTier(toolName = '') {
		const name = String(toolName || '');
		if (['click_at', 'double_click', 'mouse_move', 'drag'].includes(name)) return 'pointer';
		if (name === 'open_app') return 'native';
		if (name === 'run_ui_task') return 'planner';
		if (name === 'type_text' || name === 'press_key' || name === 'scroll') return 'ax_dom';
		return 'general';
	}

	async _drainQueue() {
		while (this.queue.length) {
			const event = this.queue.shift();
			try {
				await this._processEvent(event);
			} catch {}
		}
		this.processing = false;
	}

	async _processEvent(event) {
		if (event.type === 'memory') {
			await this._applyMemoryEvent(event);
			return;
		}
		if (event.type === 'skill') {
			await this._applySkillEvent(event);
			return;
		}
		if (event.type === 'false_positive_skill') {
			await this._applyCoreGapEvent(event);
			return;
		}
		if (event.type === 'core-gap') {
			if (event.classification?.payload?.memory) {
				await this._applyMemoryEvent({
					...event,
					type: 'memory',
					classification: {
						payload: event.classification.payload.memory,
					},
				});
			}
			await this._applyCoreGapEvent(event);
			return;
		}
		if (event.type === 'stabilization_candidate') {
			await this._applyStabilizationCandidate(event);
		}
	}

	async _applyMemoryEvent(event) {
		const payload = event.classification?.payload || {};
		const stored = this.memoryStore.upsert(payload);
		if (stored) {
			log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
		}

		if (normalizeText(event.userText).includes('default browser')) {
			const appExecution = [...this.recentToolExecutions].reverse().find((item) => item.name === 'open_app' && item.success !== false);
			const appName = appExecution?.args?.name || appExecution?.args?.resolved_name || appExecution?.args?.resolvedName || '';
			if (appName) {
				const storedApp = this.memoryStore.upsert({
					kind: 'environment_fact',
					scope: 'machine',
					key: 'environment.default_browser.app_name',
					value: appName,
					source: 'observed_success',
					confidence: 0.85,
					evidence: event.userText,
				});
				if (storedApp) {
					log.info('Learning', `Memory updated: key=${storedApp.key} value=${appName}`);
				}
			}
		}
	}

	async _applySkillEvent(event) {
		const successful = event.successfulTools?.[event.successfulTools.length - 1];
		if (!successful) return;
		const created = await this.selfImprovementManager.createSkill({
			purpose: `Recovered workflow for ${event.userText || successful.name}`,
			source_goal: event.userText || successful.name,
			trigger_source: 'user-correction',
			match_criteria: {
				intents: [event.userText || successful.name].filter(Boolean),
				keywords: [successful.name],
			},
			preferred_execution_path: {
				type: 'tool-sequence',
				sequence: event.successfulTools.map((item) => ({ name: item.name, args: item.args })),
			},
			stability: 'stable',
		});
		if (created?.ok) {
			log.info('Learning', `Learned skill created from recovery: id=${created.skillId} name=${created.skillName}`);
		}
	}

	async _applyCoreGapEvent(event) {
		const selfImprovementPolicy = inferAutonomousSelfImprovementPolicy(event.guidanceText || event.userText || '');
		if (selfImprovementPolicy) {
			const stored = this.memoryStore.upsert(selfImprovementPolicy);
			if (stored) {
				log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
			}
			return;
		}
		const directCreativePolicy = inferDirectCreativeFulfillmentPolicy(event.guidanceText || event.userText || '');
		if (directCreativePolicy) {
			const stored = this.memoryStore.upsert(directCreativePolicy);
			if (stored) {
				log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
			}
			return;
		}
		const capabilityOverviewPolicy = inferCapabilityOverviewFulfillmentPolicy(event.guidanceText || event.userText || '');
		if (capabilityOverviewPolicy) {
			const stored = this.memoryStore.upsert(capabilityOverviewPolicy);
			if (stored) {
				log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
			}
			return;
		}
		const flattenedPreparationPolicy = inferFlattenedPreparationRecoveryPolicy(event);
		if (flattenedPreparationPolicy) {
			const stored = this.memoryStore.upsert(flattenedPreparationPolicy);
			if (stored) {
				log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
			}
			return;
		}
		const partialTurnPolicy = inferPartialTurnBackgroundPolicy(event.guidanceText || event.userText || '');
		if (partialTurnPolicy) {
			const stored = this.memoryStore.upsert(partialTurnPolicy);
			if (stored) {
				log.info('Learning', `Memory updated: key=${stored.key} kind=${stored.kind} scope=${stored.scope}`);
			}
			return;
		}
		const issues = this._readJson(this.issuePath, { version: 1, updatedAt: nowIso(), issues: [] });
		const clustered = this._clusterIssue(event);
		let issue = issues.issues.find((item) => item.issueSignature === clustered.signature);
		if (!issue) {
			issue = {
				id: `issue_${hash(clustered.signature)}`,
				issueSignature: clustered.signature,
				domain: clustered.domain,
				description: event.classification?.payload?.description || event.userText || 'Structural gap detected',
				canonicalDescription: clustered.canonicalDescription,
				semanticFeatures: clustered.semanticFeatures,
				count: 0,
				status: 'pending',
				lastQueuedAt: null,
				lastResolvedAt: null,
				evidence: [],
			};
			issues.issues.push(issue);
		}
		issue.domain = issue.domain || clustered.domain;
		issue.canonicalDescription = issue.canonicalDescription || clustered.canonicalDescription;
		issue.semanticFeatures = issue.semanticFeatures || clustered.semanticFeatures;
		issue.evidence = Array.isArray(issue.evidence) ? issue.evidence : [];
		const evidence = String(event.guidanceText || event.userText || issue.description || '').trim();
		if (evidence) {
			issue.evidence.push({ at: nowIso(), text: evidence.slice(0, 220) });
			if (issue.evidence.length > 5) issue.evidence = issue.evidence.slice(-5);
		}
		issue.count += 1;
		issue.status = 'pending';
		if (event.backgroundOnly) {
			issue.status = 'background_only';
			this._writeJson(this.issuePath, issues);
			return;
		}
		const queueImmediately = event.forceImmediate === true;
		if (queueImmediately || issue.count >= 2) {
			const lastResolvedAt = issue.lastResolvedAt ? Date.parse(issue.lastResolvedAt) : 0;
			if (lastResolvedAt && Number.isFinite(lastResolvedAt) && (Date.now() - lastResolvedAt) < RECENT_SELF_FIX_COOLDOWN_MS) {
				log.info('Learning', `Skipping duplicate autonomous self-fix during cooldown: issue=${issue.issueSignature}`);
				this._writeJson(this.issuePath, issues);
				return;
			}
			if (this.activeIssues.has(issue.issueSignature) || this.activeSelfFixCount >= this._getSelfFixConcurrencyLimit()) {
				log.info('Learning', `Self-fix issue already active or throttled: issue=${issue.issueSignature}`);
				issue.status = 'deferred';
				this._enqueueDeferredIssue(issue.issueSignature, {
					...event,
					domain: issue.domain,
					issueSignature: issue.issueSignature,
					classification: event.classification,
				});
				this._writeJson(this.issuePath, issues);
				return;
			}
			this.activeIssues.add(issue.issueSignature);
			this.activeSelfFixCount += 1;
			issue.status = 'queued';
			issue.lastQueuedAt = nowIso();
			log.info('Learning', `Queued autonomous self-fix: issue=${issue.issueSignature} count=${issue.count}`);
			this._writeJson(this.issuePath, issues);
			this.selfFixTool({
				description: [
					'Autonomous self-improvement triggered by repeated user friction.',
					`Issue signature: ${issue.issueSignature}.`,
					`Domain: ${issue.domain}.`,
					`Observed guidance: ${event.guidanceText || event.userText || issue.description}.`,
					'Add or improve the missing capability so Iris learns this behavior natively and stops asking for the same guidance repeatedly.',
				].join(' '),
			}).finally(() => {
				const fresh = this._readJson(this.issuePath, { version: 1, updatedAt: nowIso(), issues: [] });
				const current = fresh.issues.find((item) => item.issueSignature === issue.issueSignature);
				if (current) {
					current.status = 'resolved';
					current.lastResolvedAt = nowIso();
					log.info('Learning', `Resolved autonomous self-fix: issue=${issue.issueSignature}`);
					this._writeJson(this.issuePath, fresh);
				}
				this.activeIssues.delete(issue.issueSignature);
				this.activeSelfFixCount = Math.max(0, this.activeSelfFixCount - 1);
				this._pumpDeferredIssues();
			});
			return;
		}
		this._writeJson(this.issuePath, issues);
	}

	async _applyStabilizationCandidate(event) {
		log.info('Learning', `Queued stabilization candidate: issue=${event.issueSignature}`);
		await this._applyCoreGapEvent({
			...event,
			type: 'core-gap',
			forceImmediate: true,
			classification: {
				payload: event.classification?.payload || {
					issueSignature: event.issueSignature,
					description: `Repeated pointer recovery needs native/semantic stabilization: ${event.guidanceText || event.userText || ''}`,
				},
			},
		});
	}
}

module.exports = {
	LearningManager,
};
