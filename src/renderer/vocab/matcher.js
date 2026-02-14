// Aho-Corasick automaton + VocabMatcher class

class AhoCorasick {
	constructor() {
		this.goto = [new Map()];
		this.fail = [0];
		this.output = [[]];
	}

	add(pattern, value) {
		const lower = pattern.toLowerCase();
		let state = 0;
		for (const ch of lower) {
			if (!this.goto[state].has(ch)) {
				const next = this.goto.length;
				this.goto.push(new Map());
				this.fail.push(0);
				this.output.push([]);
				this.goto[state].set(ch, next);
			}
			state = this.goto[state].get(ch);
		}
		this.output[state].push({ value, len: lower.length });
	}

	compile() {
		const queue = [];
		for (const [, s] of this.goto[0]) {
			this.fail[s] = 0;
			queue.push(s);
		}
		let head = 0;
		while (head < queue.length) {
			const r = queue[head++];
			for (const [ch, s] of this.goto[r]) {
				queue.push(s);
				let f = this.fail[r];
				while (f !== 0 && !this.goto[f].has(ch)) f = this.fail[f];
				this.fail[s] = this.goto[f].has(ch) && this.goto[f].get(ch) !== s
					? this.goto[f].get(ch) : 0;
				if (this.output[this.fail[s]].length) {
					this.output[s] = [...this.output[s], ...this.output[this.fail[s]]];
				}
			}
		}
	}

	search(text) {
		const lower = text.toLowerCase();
		const results = [];
		let state = 0;
		for (let i = 0; i < lower.length; i++) {
			const ch = lower[i];
			while (state !== 0 && !this.goto[state].has(ch)) state = this.fail[state];
			state = this.goto[state].has(ch) ? this.goto[state].get(ch) : 0;
			for (const out of this.output[state]) {
				results.push({ start: i - out.len + 1, end: i + 1, value: out.value, len: out.len });
			}
		}
		return results;
	}
}

function isWordChar(ch) {
	return /[a-zA-Z0-9_]/.test(ch);
}

function selectMatches(matches, text, wordBoundary) {
	let filtered = matches;
	if (wordBoundary) {
		filtered = matches.filter(m => {
			const before = m.start > 0 ? text[m.start - 1] : '';
			const after = m.end < text.length ? text[m.end] : '';
			return (before === '' || !isWordChar(before)) && (after === '' || !isWordChar(after));
		});
	}
	filtered.sort((a, b) => a.start - b.start || b.len - a.len);
	const selected = [];
	let lastEnd = 0;
	for (const m of filtered) {
		if (m.start >= lastEnd) {
			selected.push(m);
			lastEnd = m.end;
		}
	}
	return selected;
}

function applyReplacements(text, selected) {
	let result = '';
	let pos = 0;
	for (const m of selected) {
		result += text.slice(pos, m.start);
		result += m.value;
		pos = m.end;
	}
	result += text.slice(pos);
	return result;
}

export class VocabMatcher {
	constructor() {
		this._corrections = null;
		this._casing = null;
		this._allCorrections = {};
		this._allTerms = [];
		this._ready = false;
	}

	build(corrections, vocabTerms) {
		this._allCorrections = { ...(corrections || {}) };
		this._allTerms = [...(vocabTerms || [])];
		this._buildAutomata();
	}

	addCorrection(wrong, right) {
		this._allCorrections[wrong] = right;
		this._corrections = new AhoCorasick();
		for (const [w, r] of Object.entries(this._allCorrections)) {
			this._corrections.add(w, r);
		}
		this._corrections.compile();
	}

	hasCorrection(wrong) {
		return wrong in this._allCorrections;
	}

	_buildAutomata() {
		const corrEntries = Object.entries(this._allCorrections);
		if (corrEntries.length) {
			this._corrections = new AhoCorasick();
			for (const [wrong, right] of corrEntries) {
				this._corrections.add(wrong, right);
			}
			this._corrections.compile();
		}

		if (this._allTerms.length) {
			this._casing = new AhoCorasick();
			for (const term of this._allTerms) {
				this._casing.add(term, term);
			}
			this._casing.compile();
		}
		this._ready = true;
	}

	correct(text) {
		if (!text || !this._ready) return text;
		let result = text;

		if (this._corrections) {
			const matches = this._corrections.search(result);
			const selected = selectMatches(matches, result, true);
			result = applyReplacements(result, selected);
		}

		if (this._casing) {
			const matches = this._casing.search(result);
			const selected = selectMatches(matches, result, false);
			result = applyReplacements(result, selected);
		}

		return result;
	}

	scan(text) {
		if (!text || !this._casing) return [];
		const matches = this._casing.search(text);
		const seen = new Set();
		const terms = [];
		matches.sort((a, b) => b.len - a.len);
		for (const m of matches) {
			if (!seen.has(m.value)) {
				seen.add(m.value);
				terms.push(m.value);
			}
		}
		return terms;
	}
}
