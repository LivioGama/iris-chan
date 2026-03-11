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
