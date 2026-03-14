// In-memory cache of recently detected 2FA codes with TTL
const log = require('../logger');

class CodeCache {
	constructor({ maxAgeMs = 300_000, maxEntries = 20 } = {}) {
		this._maxAgeMs = maxAgeMs;
		this._maxEntries = maxEntries;
		this._entries = new Map(); // code → { code, source, sender, snippet, timestamp }
	}

	add({ code, source, sender, text, timestamp }) {
		if (!code) return;
		const snippet = (text || '')
			.replace(code, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 80);
		const existing = this._entries.get(code);
		if (existing) {
			// Update timestamp if seen again
			existing.timestamp = timestamp || Date.now();
			existing.source = source || existing.source;
			return;
		}
		this._entries.set(code, {
			code,
			source: source || 'unknown',
			sender: sender || 'unknown',
			snippet,
			timestamp: timestamp || Date.now(),
		});
		// Evict oldest if over limit
		if (this._entries.size > this._maxEntries) {
			const oldest = [...this._entries.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
			if (oldest) this._entries.delete(oldest[0]);
		}
	}

	getLatest(limit = 5) {
		this._prune();
		return [...this._entries.values()]
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, limit)
			.map(e => ({
				...e,
				age: this._formatAge(e.timestamp),
				maskedCode: e.code.slice(0, 2) + '*'.repeat(Math.max(0, e.code.length - 2)),
			}));
	}

	getByKeyword(keyword) {
		if (!keyword) return null;
		this._prune();
		const kw = keyword.toLowerCase();
		// Search sender and snippet for keyword match
		const match = [...this._entries.values()]
			.sort((a, b) => b.timestamp - a.timestamp)
			.find(e =>
				(e.sender || '').toLowerCase().includes(kw) ||
				(e.snippet || '').toLowerCase().includes(kw) ||
				(e.source || '').toLowerCase().includes(kw)
			);
		if (!match) return null;
		return {
			...match,
			age: this._formatAge(match.timestamp),
			maskedCode: match.code.slice(0, 2) + '*'.repeat(Math.max(0, match.code.length - 2)),
		};
	}

	getFullCode(maskedOrKeyword) {
		// Look up the actual code for pasting (internal use only)
		if (!maskedOrKeyword) return null;
		const kw = maskedOrKeyword.toLowerCase();
		this._prune();
		// Try keyword match first
		const byKw = [...this._entries.values()]
			.sort((a, b) => b.timestamp - a.timestamp)
			.find(e =>
				(e.sender || '').toLowerCase().includes(kw) ||
				(e.snippet || '').toLowerCase().includes(kw) ||
				(e.source || '').toLowerCase().includes(kw)
			);
		if (byKw) return byKw.code;
		// Try masked code match
		const byMasked = [...this._entries.values()].find(e => {
			const masked = e.code.slice(0, 2) + '*'.repeat(Math.max(0, e.code.length - 2));
			return masked === maskedOrKeyword;
		});
		if (byMasked) return byMasked.code;
		// Return most recent as fallback for "latest"
		if (kw === 'latest' || kw === 'last' || kw === 'recent') {
			const latest = [...this._entries.values()].sort((a, b) => b.timestamp - a.timestamp)[0];
			return latest?.code || null;
		}
		return null;
	}

	clear() {
		this._entries.clear();
	}

	get size() {
		return this._entries.size;
	}

	_prune() {
		const cutoff = Date.now() - this._maxAgeMs;
		for (const [code, entry] of this._entries) {
			if (entry.timestamp < cutoff) this._entries.delete(code);
		}
	}

	_formatAge(timestamp) {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 10) return 'just now';
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m ago`;
	}
}

module.exports = { CodeCache };
