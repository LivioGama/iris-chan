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
	['pasted', 'paste'],
	['pasting', 'paste'],
	['preferences', 'settings'],
	['queried', 'query'],
	['querying', 'query'],
	['results', 'result'],
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
		.replace(/\bgo to\b/g, 'open')
		.replace(/\bgo back\b/g, 'navigate back')
		.replace(/\bdefault browser\b/g, 'default_browser')
		.replace(/\bdefault mail\b/g, 'default_mail')
		.replace(/\bdefault app\b/g, 'default_app')
		.replace(/\bchannel link\b/g, 'channel_link')
		.replace(/\bchannel result\b/g, 'channel_result')
		.replace(/\bsystem settings\b/g, 'system_settings')
		.replace(/\bvisual studio code\b/g, 'vscode');
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
			if (targets.includes(token)) return false;
			if (apps.includes(token)) return false;
			return token.length > 2;
		}).slice(0, 6)
	);
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
				domain: inferDomain(text),
				issueSignature: classification.payload?.issueSignature || classification.key,
				userText: text,
				guidanceText: text,
				classification,
				failedTools: this.recentToolExecutions.filter((item) => item.success === false).slice(-4),
				successfulTools: this.recentToolExecutions.filter((item) => item.success !== false).slice(-4),
				createdAt: nowIso(),
			});
		}
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
		const rawText = event.guidanceText || event.userText || event.classification?.payload?.description || event.issueSignature || '';
		const text = canonicalizeIssueText(rawText);
		const tokens = tokenizeIssueText(rawText);
		const tokenSet = new Set(tokens);
		const intentFamily = deriveIntentFamily(text, tokenSet, domain);
		const targets = deriveTargetFeatures(text, tokenSet, domain);
		const apps = deriveAppFeatures(tokenSet);
		const entities = deriveEntityFeatures(tokens, targets, apps);
		const entitySignature = targets.length || apps.length ? 'none' : (entities.join('+') || 'none');
		const failedFamilies = uniqueSorted((event.failedTools || []).map((item) => toolFamily(item.name)));
		const succeededFamilies = uniqueSorted((event.successfulTools || []).map((item) => toolFamily(item.name)));
		const pointerMode = failedFamilies.includes('pointer') || succeededFamilies.includes('pointer') ? 'pointer' : 'nonpointer';
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
