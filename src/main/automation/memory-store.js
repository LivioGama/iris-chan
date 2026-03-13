const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../../shared/config').default;

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
	return new Date().toISOString();
}

function normalizeText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function createId(kind, scope, key) {
	return crypto.createHash('sha1').update(`${kind}:${scope}:${key}`).digest('hex').slice(0, 12);
}

class MemoryStore {
	constructor({ irisDir = config.paths.irisDir } = {}) {
		this.irisDir = irisDir;
		this.filePath = path.join(this.irisDir, 'memory.json');
		ensureDir(this.irisDir);
		this._cache = this._load();
		this._seedDefaults();
	}

	_load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
			if (!Array.isArray(parsed.entries)) parsed.entries = [];
			return parsed;
		} catch {
			return { version: 1, updatedAt: nowIso(), entries: [] };
		}
	}

	_save() {
		this._cache.updatedAt = nowIso();
		fs.writeFileSync(this.filePath, JSON.stringify(this._cache, null, 2), 'utf8');
	}

	_seedDefaults() {
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.default_app_resolution',
			value: {
				preferNativeMacOS: true,
				message: 'Prefer native macOS system-resolution before random app guesses for default-app requests.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.screen_visibility_reassurance',
			value: {
				enabled: true,
				message: 'When the user asks whether you can see the screen, answer yes and clarify that you see periodic screenshots unless capture is unavailable.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.status_bar_icon_visibility',
			value: {
				enabled: true,
				message: 'When the user asks about a visible status or menu bar icon such as the battery indicator, inspect the latest screen context and answer concretely from what is visible instead of asking them to restate it.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.autonomous_self_drive',
			value: {
				enabled: true,
				message: 'During autonomous coding or self-fix work, keep iterating without waiting for more user input. Self-verify each step, use verification results as the next input, keep working until the user returns, and clear the remaining todo/backlog before stopping unless a concrete blocker is reached.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.progress_accountability',
			value: {
				enabled: true,
				message: 'When the user asks what you are doing or what is already done during active work, answer with a concise progress report: current task, concrete completed work, next step, and any blocker. Do not ask them to restate the task if active work context already exists.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.terminal_log_observability',
			value: {
				enabled: true,
				message: 'When the user asks whether you can see terminal output, runtime logs, or console lines that are visible on screen, inspect the visible terminal/log pane and answer concretely from the current screen context instead of asking them to repeat it. If the text is unreadable or capture is stale, report that concrete blocker.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.task_creation_accountability',
			value: {
				enabled: true,
				message: 'When the user asks about tasks you created, queued, or opened for the current work, answer from the active work state and task history instead of asking them to restate it. Summarize each relevant task for this request, its status, completed work, next step, and any blocker. Check tasks.json when available before saying context is missing.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.editor_self_improvement_generalization',
			value: {
				enabled: true,
				message: 'When repeated user friction reveals a reusable editor or self-modification pattern, update your own code in a generic way instead of fixing only the narrow case. Generalize the learned stop/continuation behavior across similar editor tasks and do not ask for the same guidance again when the surrounding pattern matches.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.thorough_execution',
			value: {
				enabled: true,
				message: 'When the user gives terse follow-up guidance meaning "do it properly", "just do it", or "don\'t hesitate" during active work, continue the current task without asking them to restate it. Take a stronger end-to-end pass: investigate the root cause, complete the action decisively, rerun verification, and stop only at a concrete blocker.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.conflict_resolution_continuation',
			value: {
				enabled: true,
				message: 'When resolving conflicts between two change sets during active work, do a light-touch comparison first. Do not over-read either side if the intent is already clear. Preserve compatible intent from both changes, resolve the conflict decisively, and continue the active task without asking for the same guidance again.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.screen_reference_direct_action',
			value: {
				enabled: true,
				message: 'When the user gives a deictic or otherwise ambiguous pointer correction during active UI work, treat it as a screen-referential request. Use the latest screen context, visible target, and any readable on-screen label or text near that target to resolve what they mean instead of asking them to restate or point again.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.action_verification',
			value: {
				enabled: true,
				message: 'For screen-based actions, never claim "clicked", "opened", or "went there" until a fresh screenshot, DOM/app checkpoint, or other direct verification confirms the result. Do not rely on stale screenshots when deciding where to click. If verification is unavailable, say the action is unverified or blocked instead of claiming success.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.pre_click_preparation',
			value: {
				enabled: true,
				message: 'When a UI task depends on a specific app or window, open or focus that app first, refresh the screen context, and only then use pointer actions or resolve visible targets. Treat run_ui_task -> open_app recovery as missing preparation rather than a reason to ask for the same guidance again.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.presence_reassurance',
			value: {
				enabled: true,
				message: 'When the user greets you, says your name to get your attention, or asks where you are, answer briefly that you are here and listening. If active work is already in progress, treat a bare-name ping as a request for a concise status update instead of asking them to restate the task.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
		this.upsert({
			kind: 'fallback_policy',
			scope: 'machine',
			key: 'policy.direct_creative_fulfillment',
			value: {
				enabled: true,
				message: 'When the user makes a short casual creative request such as asking for a poem, joke, caption, or short story, fulfill it directly instead of asking for task clarification or workspace context. Treat brief transliterated variants like "tell me a poem" as the same request when the intent is clear.',
			},
			source: 'inferred',
			confidence: 0.95,
		});
	}

	getEntries() {
		return [...this._cache.entries];
	}

	find({ kind, scope, key } = {}) {
		return this._cache.entries.find((entry) => {
			if (kind && entry.kind !== kind) return false;
			if (scope && entry.scope !== scope) return false;
			if (key && normalizeText(entry.key) !== normalizeText(key)) return false;
			return true;
		}) || null;
	}

	getValue(key, fallback = null) {
		const match = this.find({ key });
		return match ? match.value : fallback;
	}

	upsert({ kind, scope, key, value, source = 'inferred', confidence = 0.7, evidence = null } = {}) {
		if (!kind || !scope || !key) return null;
		const existing = this.find({ kind, scope, key });
		const next = {
			id: existing?.id || createId(kind, scope, key),
			kind,
			scope,
			key,
			value,
			source,
			confidence,
			updatedAt: nowIso(),
			evidence: evidence || existing?.evidence || null,
		};
		this._cache.entries = this._cache.entries.filter((entry) => entry.id !== next.id);
		this._cache.entries.push(next);
		this._save();
		return next;
	}
}

module.exports = {
	MemoryStore,
	normalizeText,
};
