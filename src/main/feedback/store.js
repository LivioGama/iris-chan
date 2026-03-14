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

function createId(text, timestamp) {
	return 'fb_' + crypto.createHash('sha1').update(`${text}:${timestamp}`).digest('hex').slice(0, 12);
}

function inferCategory(text = '') {
	const normalized = String(text || '').toLowerCase();
	if (/\b(voice|sound|audio|speak|speech|tone|pitch|volume|accent)\b/.test(normalized)) return 'voice';
	if (/\b(remember|memory|forget|recall|context)\b/.test(normalized)) return 'preference';
	if (/\b(stop|don't|dont|never|shouldn't|shouldnt|quit|avoid)\b/.test(normalized)) return 'behavior';
	if (/\b(add|feature|tool|new|create|build|implement)\b/.test(normalized)) return 'feature';
	if (/\b(fix|bug|broken|error|crash|wrong|issue)\b/.test(normalized)) return 'fix';
	return 'other';
}

class FeedbackStore {
	constructor({ irisDir = config.paths.irisDir } = {}) {
		this.irisDir = irisDir;
		this.filePath = path.join(this.irisDir, 'feedback.json');
		ensureDir(this.irisDir);
		this._cache = this._load();
	}

	_load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
			if (!Array.isArray(parsed.items)) parsed.items = [];
			return parsed;
		} catch {
			return { version: 1, updatedAt: nowIso(), items: [] };
		}
	}

	_save() {
		this._cache.updatedAt = nowIso();
		fs.writeFileSync(this.filePath, JSON.stringify(this._cache, null, 2), 'utf8');
	}

	addItem({ text, category, source = 'conversation', metadata = {} } = {}) {
		const now = nowIso();
		const item = {
			id: createId(text || '', now),
			text: String(text || '').trim(),
			category: category || inferCategory(text),
			status: 'pending',
			source,
			createdAt: now,
			updatedAt: now,
			executedAt: null,
			metadata: metadata || {},
		};
		this._cache.items.push(item);
		this._save();
		return item;
	}

	getItems({ status, category, limit } = {}) {
		let results = [...this._cache.items];
		if (status) results = results.filter((item) => item.status === status);
		if (category) results = results.filter((item) => item.category === category);
		if (limit && limit > 0) results = results.slice(-limit);
		return results;
	}

	getItem(id) {
		return this._cache.items.find((item) => item.id === id) || null;
	}

	updateItem(id, patch = {}) {
		const item = this.getItem(id);
		if (!item) return null;
		for (const [key, value] of Object.entries(patch)) {
			if (key === 'id' || key === 'createdAt') continue;
			item[key] = value;
		}
		item.updatedAt = nowIso();
		this._save();
		return item;
	}

	removeItem(id) {
		const index = this._cache.items.findIndex((item) => item.id === id);
		if (index === -1) return false;
		this._cache.items.splice(index, 1);
		this._save();
		return true;
	}

	approveItem(id) {
		return this.updateItem(id, { status: 'approved' });
	}

	dismissItem(id) {
		return this.updateItem(id, { status: 'dismissed' });
	}

	getPendingCount() {
		return this._cache.items.filter((item) => item.status === 'pending').length;
	}

	clear({ status } = {}) {
		if (status) {
			this._cache.items = this._cache.items.filter((item) => item.status !== status);
		} else {
			this._cache.items = [];
		}
		this._save();
		return { ok: true };
	}
}

module.exports = { FeedbackStore, inferCategory };
