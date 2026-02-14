// Auto-correction learning (levenshtein, ngram matching)

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

export function findBestNgram(text, target, wordCount) {
	const words = text.split(/\s+/).filter(Boolean);
	const targetLower = target.toLowerCase();
	let best = null;
	let bestDist = Infinity;
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
