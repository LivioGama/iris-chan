// Aho-Corasick automaton for efficient multi-pattern vocabulary matching
// Matches all patterns in a single O(n + m + z) pass through the text
// n = text length, m = total pattern chars, z = number of matches

class AhoCorasick {
	constructor() {
		this.goto = [new Map()];  // goto[state][char] → next state
		this.fail = [0];          // failure links
		this.output = [[]];       // output[state] = [{value, len}]
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
		// BFS to build failure links
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
				// Merge outputs from fail chain
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

// Check if character is a word character (letter, digit, underscore)
function isWordChar(ch) {
	return /[a-zA-Z0-9_]/.test(ch);
}

// Select non-overlapping matches: longest wins, then earliest
function selectMatches(matches, text, wordBoundary) {
	let filtered = matches;
	if (wordBoundary) {
		filtered = matches.filter(m => {
			const before = m.start > 0 ? text[m.start - 1] : '';
			const after = m.end < text.length ? text[m.end] : '';
			return (before === '' || !isWordChar(before)) && (after === '' || !isWordChar(after));
		});
	}
	// Sort: earliest first, then longest at same position
	filtered.sort((a, b) => a.start - b.start || b.len - a.len);
	// Greedy non-overlapping selection
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

// Levenshtein edit distance
export function levenshtein(a, b) {
	const m = a.length, n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const curr = [i];
		for (let j = 1; j <= n; j++) {
			curr[j] = a[i - 1] === b[j - 1]
				? prev[j - 1]
				: 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
		}
		prev = curr;
	}
	return prev[n];
}

// Find the n-gram in text closest to target (by edit distance)
export function findBestNgram(text, target, wordCount) {
	const words = text.split(/\s+/).filter(Boolean);
	const targetLower = target.toLowerCase();
	let best = null;
	let bestDist = Infinity;
	// Try exact word count and ±1
	for (const wc of [wordCount, wordCount + 1, wordCount - 1]) {
		if (wc < 1 || wc > words.length) continue;
		for (let i = 0; i <= words.length - wc; i++) {
			const ngram = words.slice(i, i + wc).join(' ');
			const dist = levenshtein(ngram.toLowerCase(), targetLower);
			if (dist < bestDist) {
				bestDist = dist;
				best = ngram;
			}
		}
	}
	return best ? { ngram: best, distance: bestDist } : null;
}

export class VocabMatcher {
	constructor() {
		this._corrections = null;
		this._casing = null;
		this._allCorrections = {};
		this._allTerms = [];
		this._ready = false;
	}

	// Build both automata from corrections map and vocab terms list
	build(corrections, vocabTerms) {
		this._allCorrections = { ...(corrections || {}) };
		this._allTerms = [...(vocabTerms || [])];
		this._buildAutomata();
	}

	// Add a single correction at runtime and rebuild the corrections automaton
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

	// Two-phase correction: phonetic fixes (word-bounded) → casing fixes
	correct(text) {
		if (!text || !this._ready) return text;
		let result = text;

		// Phase 1: Phonetic corrections with word boundary enforcement
		if (this._corrections) {
			const matches = this._corrections.search(result);
			const selected = selectMatches(matches, result, true);
			result = applyReplacements(result, selected);
		}

		// Phase 2: Casing normalization (no word boundary — fix "claude's" → "Claude's")
		if (this._casing) {
			const matches = this._casing.search(result);
			const selected = selectMatches(matches, result, false);
			result = applyReplacements(result, selected);
		}

		return result;
	}

	// Single-pass scan: return all unique vocab terms found in text
	scan(text) {
		if (!text || !this._casing) return [];
		const matches = this._casing.search(text);
		const seen = new Set();
		const terms = [];
		// Longest matches first for dedup (so "Claude Code" beats "Claude")
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
