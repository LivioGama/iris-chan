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

		const goal = args.goal || args.name || '';
		const appHint = args.app_hint || args.appHint || '';
		const learned = this.selfImprovementManager?.findMatchingSkill?.({ goal, appHint });
		const sequence = learned?.preferredExecutionPath?.sequence;
		if (!learned || !Array.isArray(sequence) || sequence.length !== 1) return { name, args };
		const [step] = sequence;
		if (!step || step.name !== name) return { name, args };
		log.info('Learning', `Applying learned tool sequence: skill=${learned.id} tool=${name}`);
		return {
			name,
			args: { ...(args || {}), ...(step.args || {}), learned_skill_id: learned.id },
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
		const text = normalizeIssueText(event.guidanceText || event.userText || event.classification?.payload?.description || event.issueSignature || '');
		const failed = (event.failedTools || []).map((item) => item.name).filter(Boolean).join(',');
		const succeeded = (event.successfulTools || []).map((item) => item.name).filter(Boolean).join(',');
		const family = event.type === 'stabilization_candidate'
			? 'stabilize'
			: event.type === 'skill'
				? 'skill'
				: event.type === 'false_positive_skill'
					? 'false_positive'
					: 'core_gap';
		return {
			signature: `${family}:${domain}:${text}:${failed}->${succeeded}`.slice(0, 280),
			domain,
			canonicalDescription: text || 'structural gap',
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
