/**
 * Fuzzy match voice transcription tokens against known vocabulary terms.
 * Uses Levenshtein distance for close matches.
 */

const levenshtein = (a: string, b: string): number => {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array(lb + 1).fill(0),
  );

  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[la][lb];
};

export interface MatchResult {
  original: string;
  matched: string;
  distance: number;
}

/**
 * Match a word against vocab terms. Returns best match if within threshold.
 * Threshold: max 30% of term length, minimum 1, maximum 3.
 */
export const fuzzyMatch = (
  word: string,
  terms: string[],
): MatchResult | null => {
  if (word.length < 3) return null;

  const lower = word.toLowerCase();
  let bestMatch: MatchResult | null = null;
  let bestDist = Infinity;

  for (const term of terms) {
    const termLower = term.toLowerCase();

    // Exact match (case-insensitive)
    if (lower === termLower) {
      return { original: word, matched: term, distance: 0 };
    }

    // Skip if length difference is too large
    if (Math.abs(word.length - term.length) > 3) continue;

    const dist = levenshtein(lower, termLower);
    const threshold = Math.min(3, Math.max(1, Math.floor(term.length * 0.3)));

    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestMatch = { original: word, matched: term, distance: dist };
    }
  }

  return bestMatch;
};

/**
 * Match all words in a transcript against vocab terms.
 */
export const matchTranscript = (
  transcript: string,
  terms: string[],
): MatchResult[] => {
  const words = transcript.split(/\s+/).filter((w) => w.length >= 3);
  const results: MatchResult[] = [];

  for (const word of words) {
    const match = fuzzyMatch(word, terms);
    if (match && match.distance > 0) {
      results.push(match);
    }
  }

  return results;
};
