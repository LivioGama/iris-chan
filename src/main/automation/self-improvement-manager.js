const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../../shared/config').default;
const log = require('../logger');
const { planLikelySatisfiesGoal, inferDomain } = require('./skill-policy');

const REGISTRY_VERSION = 1;
const REPEAT_THRESHOLD = 2;
const FAILURE_THRESHOLD = 2;
const MAX_REPLACEMENTS_PER_DAY = 3;
const DEFAULT_INFERENCE_POLICY = 'full_domain_bundle';
const DEFAULT_QUESTION_POLICY = 'zero_questions';
const DEFAULT_STEERING_DECISION_TYPES = ['provider_choice', 'publish_or_send', 'destructive_action'];
const EXECUTION_LANE_ALIASES = Object.freeze({
	core: 'core',
	skill: 'skill',
	memory: 'memory',
	safety: 'safety',
	research: 'research-observability',
	observability: 'research-observability',
	'research-observability': 'research-observability',
	research_observability: 'research-observability',
	'research/observability': 'research-observability',
});
const LANE_PROFILE_DEFAULTS = Object.freeze({
	core: Object.freeze({
		profile: 'core-self-fix',
		hireable: false,
		capabilityBundle: ['modify_core_runtime', 'ship_self_fix'],
	}),
	skill: Object.freeze({
		profile: 'workflow-generalist',
		hireable: true,
		capabilityBundle: ['fulfill_request', 'adjacent_follow_up_readiness'],
	}),
	memory: Object.freeze({
		profile: 'memory-architect',
		hireable: true,
		capabilityBundle: ['capture_context', 'maintain_memory', 'promote_reusable_policy'],
	}),
	safety: Object.freeze({
		profile: 'safety-guardian',
		hireable: true,
		capabilityBundle: ['guardrail_review', 'risk_reduction', 'verification_enforcement'],
	}),
	'research-observability': Object.freeze({
		profile: 'observability-researcher',
		hireable: true,
		capabilityBundle: ['instrumentation', 'runtime_analysis', 'evidence_synthesis'],
	}),
});
const STOP_WORDS = new Set([
	'a', 'an', 'and', 'app', 'application', 'back', 'browser', 'click', 'current',
	'for', 'forward', 'go', 'history', 'in', 'inside', 'my', 'of', 'on', 'open',
	'page', 'please', 'search', 'tab', 'the', 'to', 'window', 'with',
]);

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.replace(/["'`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function slugify(value = '') {
	return normalizeText(value)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48) || 'skill';
}

function hashText(value = '') {
	return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

function extractKeywords(goal = '') {
	const words = normalizeText(goal).split(/\s+/).filter(Boolean);
	return Array.from(new Set(words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)))).slice(0, 8);
}

function inferCapabilityBundle(args = {}) {
	const lane = normalizeExecutionLane(args.execution_lane || args.executionLane || args.lane);
	if (lane && lane !== 'core' && lane !== 'skill') {
		const laneDefaults = LANE_PROFILE_DEFAULTS[lane];
		if (Array.isArray(laneDefaults?.capabilityBundle) && laneDefaults.capabilityBundle.length) {
			return [...laneDefaults.capabilityBundle];
		}
	}
	const sourceGoal = normalizeText(args.source_goal || args.sourceGoal || '');
	const purpose = normalizeText(args.purpose || args.description || '');
	const intents = Array.isArray(args.match_criteria?.intents || args.matchCriteria?.intents)
		? (args.match_criteria?.intents || args.matchCriteria?.intents).map(normalizeText)
		: [];
	const text = [sourceGoal, purpose, ...intents].filter(Boolean).join(' ');

	if (!text) return ['fulfill_request'];
	if (/\b(image|images|photo|photos|picture|pictures|logo|logos|illustration|illustrations|art|artwork|design|poster|banner)\b/.test(text)) {
		return ['create', 'edit', 'revise', 'generate_variants', 'export'];
	}
	if (/\binstall\b.*\bskill\b|\badd\b.*\bskill\b|\bconfigure\b.*\bskill\b|\bskill installation\b/.test(text)) {
		return ['install', 'configure', 'verify', 'basic_usage'];
	}
	if (/\b(draft|write|writing|compose|content|blog|post|article|copy|newsletter|memo|doc|document)\b/.test(text)) {
		return ['draft', 'revise', 'format'];
	}
	return ['fulfill_request', 'adjacent_follow_up_readiness'];
}

function normalizeExecutionLane(value = '') {
	const normalized = normalizeText(value).replace(/\s+/g, '-');
	return EXECUTION_LANE_ALIASES[normalized] || 'skill';
}

function inferHireableProfile(args = {}, lane = normalizeExecutionLane(args.execution_lane || args.executionLane || args.lane)) {
	const explicit = normalizeText(args.hireable_profile || args.hireableProfile || args.profile || '');
	if (explicit) return explicit;
	return LANE_PROFILE_DEFAULTS[lane]?.profile || LANE_PROFILE_DEFAULTS.skill.profile;
}

function inferHireableFlag(args = {}, lane = normalizeExecutionLane(args.execution_lane || args.executionLane || args.lane)) {
	if (typeof args.hireable === 'boolean') return args.hireable;
	return Boolean(LANE_PROFILE_DEFAULTS[lane]?.hireable);
}

function inferLaneFromIntent(args = {}) {
	const text = normalizeText([
		args.purpose,
		args.description,
		args.source_goal,
		args.sourceGoal,
	].filter(Boolean).join(' '));
	if (!text) return 'skill';
	if (/\bmemory|remember|policy|context|history|recall\b/.test(text)) return 'memory';
	if (/\bsafety|guardrail|permission|verify|verification|risk|danger|destructive\b/.test(text)) return 'safety';
	if (/\bresearch|observability|instrument|telemetry|runtime|logs?|metrics|benchmark|evidence|debug\b/.test(text)) return 'research-observability';
	return 'skill';
}

function createPlanSignature(plan = {}) {
	return JSON.stringify({
		appHint: normalizeText(plan.appHint || ''),
		successSignal: normalizeText(plan.successSignal || ''),
		steps: (Array.isArray(plan.steps) ? plan.steps : []).map((step) => ({
			type: step.type || '',
			appHint: normalizeText(step.appHint || step.appName || ''),
			url: step.url || '',
			value: normalizeText(step.value || ''),
			direction: normalizeText(step.direction || ''),
			query: normalizeText(step.query || ''),
			resultKind: normalizeText(step.resultKind || ''),
			selectorText: normalizeText(step.selector?.text || ''),
			selectorRole: normalizeText(step.selector?.role || ''),
		})),
	});
}

function nowIso() {
	return new Date().toISOString();
}

function buildDefaultRegistry() {
	return {
		version: REGISTRY_VERSION,
		updatedAt: nowIso(),
		skills: [],
		patterns: [],
	};
}

function frontmatter(meta = {}, body = '') {
	const lines = ['---'];
	for (const [key, value] of Object.entries(meta)) lines.push(`${key}: ${String(value)}`);
	lines.push('---', body.trim(), '');
	return lines.join('\n');
}

function buildMetaSkillPrompt() {
	return [
		'Create or revise another skill package for Iris.',
		'Prefer prompt-only or simple script-backed skills when possible.',
		'Store generated skills under ~/.iris/skills and include match criteria, preferred execution path, fallback path, and lineage metadata.',
	].join('\n');
}

function buildSkillPrompt(entry) {
	const appScope = entry.match?.appNames?.length ? `App scope: ${entry.match.appNames.join(', ')}` : 'App scope: any';
	const keywords = entry.match?.keywords?.length ? `Keywords: ${entry.match.keywords.join(', ')}` : 'Keywords: none';
	const capabilityBundle = Array.isArray(entry.capabilityBundle) && entry.capabilityBundle.length
		? `Capability bundle: ${entry.capabilityBundle.join(', ')}`
		: 'Capability bundle: fulfill_request';
	const questionPolicy = `Question policy: ${entry.questionPolicy || DEFAULT_QUESTION_POLICY}`;
	const laneLine = `Execution lane: ${entry.executionLane || 'skill'}`;
	const hireableLine = `Hireable profile: ${entry.hireableProfile || 'workflow-generalist'} (${entry.hireable ? 'hireable' : 'internal-only'})`;
	return [
		`Purpose: ${entry.description}`,
		appScope,
		keywords,
		capabilityBundle,
		laneLine,
		hireableLine,
		questionPolicy,
		`Stability: ${entry.stability || 'stable'}`,
		'This skill was auto-generated by Iris self-improvement.',
		'Preferred execution path and metadata live in metadata.json.',
	].join('\n');
}

function buildRunnerSource() {
	return `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const metadataPath = path.join(__dirname, '..', 'metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let args = {};
  try { args = input.trim() ? JSON.parse(input) : {}; } catch {}
  const result = {
    ok: true,
    skillId: metadata.id,
    version: metadata.version,
    result: metadata.description || metadata.name,
    preferredExecutionPath: metadata.preferredExecutionPath || null,
    fallbackPath: metadata.fallbackPath || null,
    args,
  };
  process.stdout.write(JSON.stringify(result));
});
`;
}

class SelfImprovementManager {
	constructor({ skillsEngine = null, selfFixTool = null, irisDir = config.paths.irisDir } = {}) {
		this.skillsEngine = skillsEngine || require('../skills');
		this.selfFixTool = selfFixTool || require('../tools/self-fix').self_fix;
		this.irisDir = irisDir;
		this.skillsDir = path.join(this.irisDir, 'skills');
		this.registryPath = path.join(this.skillsDir, '_registry.json');
		this.metaSkillDir = path.join(this.skillsDir, 'skill-author');
		ensureDir(this.skillsDir);
		this.ensureRegistry();
		this.ensureMetaSkillInstalled();
	}

	ensureRegistry() {
		if (!fs.existsSync(this.registryPath)) {
			fs.writeFileSync(this.registryPath, JSON.stringify(buildDefaultRegistry(), null, 2), 'utf8');
		}
	}

	loadRegistry() {
		this.ensureRegistry();
		const data = safeReadJson(this.registryPath, buildDefaultRegistry());
		if (!Array.isArray(data.skills)) data.skills = [];
		if (!Array.isArray(data.patterns)) data.patterns = [];
		return data;
	}

	saveRegistry(registry) {
		registry.updatedAt = nowIso();
		fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
	}

	refreshSkills() {
		try {
			return this.skillsEngine.scan();
		} catch {
			return [];
		}
	}

	ensureMetaSkillInstalled() {
		ensureDir(this.metaSkillDir);
		const skillMdPath = path.join(this.metaSkillDir, 'SKILL.md');
		if (!fs.existsSync(skillMdPath)) {
			fs.writeFileSync(skillMdPath, frontmatter({
				name: 'skill-author',
				description: 'Create or revise another skill package for Iris',
			}, buildMetaSkillPrompt()), 'utf8');
		}
		const scriptsDir = path.join(this.metaSkillDir, 'scripts');
		ensureDir(scriptsDir);
		const runnerPath = path.join(scriptsDir, 'create_skill.js');
		if (!fs.existsSync(runnerPath)) {
			fs.writeFileSync(runnerPath, buildRunnerSource(), 'utf8');
			fs.chmodSync(runnerPath, 0o755);
		}
	}

	createSkill(args = {}) {
		const lane = this.chooseLane(args);
		if (lane === 'core') {
			log.info('Learning', `Escalating learning artifact to self_fix: purpose=${String(args.description || args.purpose || '').slice(0, 140)}`);
			return this.selfFixTool({
				description: args.description || args.purpose || 'Create a core self-improvement change for Iris',
			});
		}
		const created = this.writeSkillPackage(args);
		this.refreshSkills();
		log.info('Learning', `Created learned skill: id=${created.entry.id} name=${created.entry.name} version=${created.entry.version} origin=${created.entry.origin}`);
		return {
			ok: true,
			result: `Created skill ${created.entry.name} (${created.entry.id})`,
			skillId: created.entry.id,
			skillName: created.entry.name,
			version: created.entry.version,
			path: created.path,
			registryPath: this.registryPath,
			lane,
		};
	}

	chooseLane(args = {}) {
		const requestedLaneRaw = args.execution_lane || args.executionLane || args.lane;
		if (requestedLaneRaw) {
			const requestedLane = normalizeExecutionLane(requestedLaneRaw);
			if (requestedLane === 'core') return 'core';
			if (requestedLane !== 'skill') return requestedLane;
		}
		if (args.force_core === true) return 'core';
		const executionType = String(args.preferred_execution_path?.type || args.preferredExecutionPath?.type || '').trim();
		if (executionType === 'self_fix') return 'core';
		return inferLaneFromIntent(args);
	}

	writeSkillPackage(args = {}, existingEntry = null) {
		const registry = this.loadRegistry();
		const match = args.match_criteria || args.matchCriteria || {};
		const appScope = Array.isArray(args.app_scope) ? args.app_scope : (args.app_scope ? [args.app_scope] : (match.appNames || []));
		const purpose = String(args.purpose || args.description || 'Auto-generated skill').trim();
		const sourceGoal = String(args.source_goal || match.goal || purpose).trim();
		const skillId = existingEntry?.id || `auto-${hashText(`${sourceGoal}:${appScope.join(',')}:${JSON.stringify(args.preferred_execution_path || args.preferredExecutionPath || {})}`)}`;
		const version = existingEntry ? Number(existingEntry.version || 1) + 1 : 1;
		const baseName = existingEntry?.name || `auto-${slugify(appScope[0] || sourceGoal).slice(0, 28)}`;
		const skillName = version > 1 ? `${baseName}-v${version}` : baseName;
		const skillSlug = slugify(skillName);
		const skillDir = path.join(this.skillsDir, skillSlug);
		const preferredExecutionPath = args.preferred_execution_path || args.preferredExecutionPath || {};
		const fallbackPath = args.fallback_path || args.fallbackPath || null;
		const executionLane = this.chooseLane(args);
		const hireableProfile = inferHireableProfile(args, executionLane);
		const hireable = inferHireableFlag(args, executionLane);
		const keywords = Array.isArray(match.keywords) && match.keywords.length ? match.keywords : extractKeywords(sourceGoal);
		const capabilityBundle = Array.isArray(args.capability_bundle)
			? args.capability_bundle
			: Array.isArray(args.capabilityBundle)
				? args.capabilityBundle
				: Array.isArray(existingEntry?.capabilityBundle) && existingEntry.capabilityBundle.length
					? existingEntry.capabilityBundle
					: inferCapabilityBundle({ ...args, source_goal: sourceGoal, purpose });
		const inferencePolicy = args.inference_policy || args.inferencePolicy || existingEntry?.inferencePolicy || DEFAULT_INFERENCE_POLICY;
		const questionPolicy = args.question_policy || args.questionPolicy || existingEntry?.questionPolicy || DEFAULT_QUESTION_POLICY;
		const steeringDecisionTypes = Array.isArray(args.steering_decision_types)
			? args.steering_decision_types
			: Array.isArray(args.steeringDecisionTypes)
				? args.steeringDecisionTypes
				: Array.isArray(existingEntry?.steeringDecisionTypes) && existingEntry.steeringDecisionTypes.length
					? existingEntry.steeringDecisionTypes
					: [...DEFAULT_STEERING_DECISION_TYPES];
		const entry = {
			id: skillId,
			name: skillName,
			baseName,
			slug: skillSlug,
			description: purpose,
			status: 'active',
			version,
			activeVersion: version,
			path: skillDir,
			origin: args.trigger_source || args.triggerSource || 'user-requested',
			stability: args.stability || 'stable',
			domain: args.domain || inferDomain(sourceGoal),
			routingPriority: Number(existingEntry?.routingPriority ?? args.routingPriority ?? 100),
			demotionCount: Number(existingEntry?.demotionCount ?? 0),
			executionLane,
			hireableProfile,
			hireable,
			capabilityBundle,
			inferencePolicy,
			questionPolicy,
			steeringDecisionTypes,
			match: {
				appNames: appScope.filter(Boolean),
				intents: Array.isArray(match.intents) && match.intents.length ? match.intents.map(normalizeText) : [normalizeText(sourceGoal)].filter(Boolean),
				keywords,
				preconditions: Array.isArray(match.preconditions) ? match.preconditions : [],
			},
			preferredExecutionPath,
			fallbackPath,
			lineage: {
				replaces: existingEntry?.id || args.replaces || null,
				replacedBy: null,
			},
			stats: {
				successCount: existingEntry?.stats?.successCount || 0,
				failureCount: existingEntry?.stats?.failureCount || 0,
				lastOutcome: existingEntry?.stats?.lastOutcome || 'created',
				lastUsedAt: existingEntry?.stats?.lastUsedAt || null,
			},
			failureWindow: [],
			replacementHistory: Array.isArray(existingEntry?.replacementHistory) ? [...existingEntry.replacementHistory] : [],
			createdAt: existingEntry?.createdAt || nowIso(),
			updatedAt: nowIso(),
		};

		ensureDir(skillDir);
		ensureDir(path.join(skillDir, 'scripts'));
		fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter({
			name: skillName,
			description: purpose,
		}, buildSkillPrompt(entry)), 'utf8');
		fs.writeFileSync(path.join(skillDir, 'metadata.json'), JSON.stringify(entry, null, 2), 'utf8');
		const runnerPath = path.join(skillDir, 'scripts', 'run.js');
		fs.writeFileSync(runnerPath, buildRunnerSource(), 'utf8');
		fs.chmodSync(runnerPath, 0o755);

		const withoutExisting = registry.skills.filter((item) => item.id !== skillId);
		if (existingEntry) {
			const stale = { ...existingEntry, status: 'stale', updatedAt: nowIso(), lineage: { ...(existingEntry.lineage || {}), replacedBy: skillId } };
			withoutExisting.push(stale);
		}
		withoutExisting.push(entry);
		registry.skills = withoutExisting;
		this.saveRegistry(registry);
		return { entry, path: skillDir };
	}

	findMatchingSkill({ goal = '', appHint = '' } = {}) {
		const registry = this.loadRegistry();
		const normalizedGoal = normalizeText(goal);
		const normalizedApp = normalizeText(appHint);
		let best = null;
		let bestScore = 0;
		for (const entry of registry.skills) {
			if (!entry || entry.status !== 'active') continue;
			if (entry.stability && entry.stability !== 'stable') continue;
			if (entry.preferredExecutionPath?.plan && !planLikelySatisfiesGoal(goal, entry.preferredExecutionPath?.plan || {})) continue;
			const appNames = Array.isArray(entry.match?.appNames) ? entry.match.appNames.map(normalizeText) : [];
			if (appNames.length && normalizedApp && !appNames.includes(normalizedApp)) continue;
			let score = 0;
			for (const intent of entry.match?.intents || []) {
				if (intent && normalizedGoal.includes(normalizeText(intent))) score += 5;
			}
			for (const keyword of entry.match?.keywords || []) {
				if (keyword && normalizedGoal.includes(normalizeText(keyword))) score += 1;
			}
			if (appNames.length && normalizedApp && appNames.includes(normalizedApp)) score += 3;
			score += Math.max(0, Number(entry.routingPriority || 0)) / 100;
			if (score > bestScore) {
				bestScore = score;
				best = entry;
			}
		}
		if (!best || bestScore < 3) return null;
		log.info('Learning', `Matched learned skill: id=${best.id} name=${best.name} score=${bestScore} goal=${String(goal || '').slice(0, 120)}`);
		return best;
	}

	buildPlanFromSkill(entry, fallback = {}) {
		const plan = entry?.preferredExecutionPath?.plan;
		if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return null;
		return {
			...plan,
			goal: fallback.goal || plan.goal || entry.description,
			appHint: fallback.appHint || plan.appHint || '',
			successSignal: fallback.successSignal || plan.successSignal || '',
			learnedSkillId: entry.id,
			learnedSkillName: entry.name,
		};
	}

	recordLearnedOutcome(entry, success, details = {}) {
		if (!entry?.id) return null;
		if (details?.successType === 'false_positive') {
			return this.recordFalsePositiveSkill(entry, details);
		}
		const registry = this.loadRegistry();
		const current = registry.skills.find((item) => item.id === entry.id && item.status === 'active');
		if (!current) return null;
		current.stats = current.stats || {};
		current.stats.lastUsedAt = nowIso();
		current.stats.lastOutcome = success ? 'success' : 'failure';
		current.stats.successCount = Number(current.stats.successCount || 0) + (success ? 1 : 0);
		current.stats.failureCount = Number(current.stats.failureCount || 0) + (success ? 0 : 1);
		current.updatedAt = nowIso();
		if (!success) {
			const ts = Date.now();
			current.failureWindow = (Array.isArray(current.failureWindow) ? current.failureWindow : []).filter((item) => ts - Number(item.timestamp || 0) < 24 * 60 * 60 * 1000);
			current.failureWindow.push({ timestamp: ts, message: String(details.error || details.result || 'failure').slice(0, 240) });
		} else {
			current.failureWindow = [];
		}
		this.saveRegistry(registry);
		log.info('Learning', `Recorded learned skill outcome: id=${entry.id} success=${success} detail=${String(details.error || details.result || '').slice(0, 140)}`);
		return current;
	}

	recordFalsePositiveSkill(entry, details = {}) {
		if (!entry?.id) return null;
		const registry = this.loadRegistry();
		const current = registry.skills.find((item) => item.id === entry.id && item.status === 'active');
		if (!current) return null;
		current.demotionCount = Number(current.demotionCount || 0) + 1;
		current.routingPriority = Math.max(0, Number(current.routingPriority || 100) - 35);
		current.stats = current.stats || {};
		current.stats.lastFalsePositiveAt = nowIso();
		current.stats.lastOutcome = 'false_positive';
		if (current.demotionCount >= 2) {
			current.stability = 'needs_stabilization';
		}
		current.updatedAt = nowIso();
		this.saveRegistry(registry);
		log.info('Learning', `Demoted false-positive learned skill: id=${entry.id} demotions=${current.demotionCount} priority=${current.routingPriority} reason=${String(details.reason || details.result || '').slice(0, 140)}`);
		return current;
	}

	shouldReplaceSkill(entry) {
		const failures = Array.isArray(entry.failureWindow) ? entry.failureWindow : [];
		if (failures.length < FAILURE_THRESHOLD) return false;
		const replacementsToday = (entry.replacementHistory || []).filter((item) => {
			return Date.now() - new Date(item.at).getTime() < 24 * 60 * 60 * 1000;
		});
		return replacementsToday.length < MAX_REPLACEMENTS_PER_DAY;
	}

	replaceSkill(entry, context = {}) {
		log.info('Learning', `Replacing learned skill: id=${entry.id} name=${entry.name}`);
		const replacementArgs = {
			purpose: context.purpose || entry.description,
			source_goal: context.goal || entry.match?.intents?.[0] || entry.description,
			app_scope: entry.match?.appNames || [],
			trigger_source: 'replacement',
			match_criteria: entry.match,
			preferred_execution_path: context.preferredExecutionPath || entry.preferredExecutionPath,
			fallback_path: context.fallbackPath || entry.fallbackPath,
			capability_bundle: context.capabilityBundle || entry.capabilityBundle,
			inference_policy: context.inferencePolicy || entry.inferencePolicy,
			question_policy: context.questionPolicy || entry.questionPolicy,
			steering_decision_types: context.steeringDecisionTypes || entry.steeringDecisionTypes,
			replaces: entry.id,
			execution_lane: context.executionLane || entry.executionLane,
			hireable_profile: context.hireableProfile || entry.hireableProfile,
			hireable: context.hireable ?? entry.hireable,
		};
		const created = this.writeSkillPackage(replacementArgs, entry);
		const registry = this.loadRegistry();
		const active = registry.skills.find((item) => item.id === entry.id && item.status === 'active');
		if (active) {
			active.replacementHistory = Array.isArray(active.replacementHistory) ? active.replacementHistory : [];
			active.replacementHistory.push({ at: nowIso(), newVersion: created.entry.version });
			active.updatedAt = nowIso();
			this.saveRegistry(registry);
		}
		this.refreshSkills();
		log.info('Learning', `Replaced learned skill: id=${created.entry.id} version=${created.entry.version}`);
		return created.entry;
	}

	recordSuccessfulPlan({ goal = '', appHint = '', plan = null, usedLearnedSkill = false, recoveredFromSkillFailure = false } = {}) {
		if (!plan || !Array.isArray(plan.steps) || plan.steps.length < 2 || usedLearnedSkill) return null;
		const registry = this.loadRegistry();
		const signature = createPlanSignature(plan);
		let pattern = registry.patterns.find((item) => item.signature === signature && normalizeText(item.appHint || '') === normalizeText(appHint || plan.appHint || ''));
		if (!pattern) {
			pattern = {
				signature,
				appHint: appHint || plan.appHint || '',
				goal: goal || plan.goal || '',
				count: 0,
				lastSeenAt: null,
				learnedSkillId: null,
			};
			registry.patterns.push(pattern);
		}
		pattern.count += 1;
		pattern.lastSeenAt = nowIso();
		this.saveRegistry(registry);

		if (pattern.learnedSkillId) return null;
		if (pattern.count < REPEAT_THRESHOLD && !recoveredFromSkillFailure) return null;

		const existing = this.findMatchingSkill({ goal: goal || plan.goal, appHint: appHint || plan.appHint });
		if (existing) {
			pattern.learnedSkillId = existing.id;
			this.saveRegistry(registry);
			return existing;
		}

		const created = this.createSkill({
			purpose: `Autonomous workflow for ${goal || plan.goal || 'multistep task'}`,
			source_goal: goal || plan.goal || '',
			app_scope: appHint || plan.appHint || '',
			trigger_source: recoveredFromSkillFailure ? 'failure-driven' : 'repeated-pattern',
			match_criteria: {
				appNames: [appHint || plan.appHint || ''].filter(Boolean),
				intents: [goal || plan.goal || ''].filter(Boolean),
				keywords: extractKeywords(goal || plan.goal || ''),
			},
			preferred_execution_path: {
				type: 'ui-plan',
				plan,
			},
			stability: 'stable',
		});
		if (created.ok) {
			log.info('Learning', `Promoted repeated pattern to learned skill: signature=${signature.slice(0, 80)} skillId=${created.skillId}`);
			const updated = this.loadRegistry();
			const current = updated.patterns.find((item) => item.signature === signature && normalizeText(item.appHint || '') === normalizeText(appHint || plan.appHint || ''));
			if (current) {
				current.learnedSkillId = created.skillId;
				this.saveRegistry(updated);
			}
		}
		return created;
	}
}

module.exports = {
	SelfImprovementManager,
	DEFAULT_INFERENCE_POLICY,
	DEFAULT_QUESTION_POLICY,
	DEFAULT_STEERING_DECISION_TYPES,
	normalizeExecutionLane,
	inferHireableProfile,
	extractKeywords,
	inferCapabilityBundle,
	normalizeText,
};
