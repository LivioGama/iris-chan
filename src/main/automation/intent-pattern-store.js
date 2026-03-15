const fs = require('node:fs');
const path = require('node:path');
const config = require('../../shared/config').default;

const STORE_PATH = path.join(config.paths.irisDir, 'intent-patterns.json');
const MIN_SAMPLES_FOR_HIT_RATE = 5;

function nowIso() {
	return new Date().toISOString();
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

class IntentPatternStore {
	constructor() {
		ensureDir(config.paths.irisDir);
		this._cache = this._load();
	}

	_load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
			if (!Array.isArray(parsed.patterns)) parsed.patterns = [];
			return parsed;
		} catch {
			return { version: 1, updatedAt: nowIso(), patterns: [] };
		}
	}

	_save() {
		this._cache.updatedAt = nowIso();
		fs.writeFileSync(STORE_PATH, JSON.stringify(this._cache, null, 2), 'utf8');
	}

	_findOrCreate(appName, timeOfDay, intentType) {
		let entry = this._cache.patterns.find(
			(p) => p.appName === appName && p.timeOfDay === timeOfDay && p.intentType === intentType,
		);
		if (!entry) {
			entry = { appName, timeOfDay, intentType, count: 0, hits: 0, misses: 0, lastSeenAt: nowIso() };
			this._cache.patterns.push(entry);
		}
		return entry;
	}

	recordPrediction({ appName, timeOfDay, intentType }) {
		if (!appName || !intentType) return;
		const entry = this._findOrCreate(appName, timeOfDay || 'unknown', intentType);
		entry.count += 1;
		entry.lastSeenAt = nowIso();
		this._save();
	}

	recordOutcome({ appName, timeOfDay, intentType, hit }) {
		if (!appName || !intentType) return;
		const entry = this._findOrCreate(appName, timeOfDay || 'unknown', intentType);
		if (hit) {
			entry.hits += 1;
		} else {
			entry.misses += 1;
		}
		entry.lastSeenAt = nowIso();
		this._save();
	}

	getTopPatterns({ appName, timeOfDay, limit = 5 } = {}) {
		return this._cache.patterns
			.filter((p) => {
				if (appName && p.appName !== appName) return false;
				if (timeOfDay && p.timeOfDay !== timeOfDay) return false;
				return p.count > 0;
			})
			.sort((a, b) => b.count - a.count)
			.slice(0, limit);
	}

	getHitRate({ intentType }) {
		const matching = this._cache.patterns.filter((p) => p.intentType === intentType);
		const totalHits = matching.reduce((sum, p) => sum + p.hits, 0);
		const totalMisses = matching.reduce((sum, p) => sum + p.misses, 0);
		const total = totalHits + totalMisses;
		if (total < MIN_SAMPLES_FOR_HIT_RATE) return null;
		return totalHits / total;
	}
}

module.exports = { IntentPatternStore };
