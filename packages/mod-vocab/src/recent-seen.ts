/**
 * Track recently-seen terms with TTL for voice context.
 */

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX = 24;

interface SeenEntry {
  term: string;
  seenAt: number;
}

export const createRecentSeenStore = (
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX,
) => {
  const entries: SeenEntry[] = [];

  const prune = () => {
    const cutoff = Date.now() - ttlMs;
    while (entries.length > 0 && entries[0].seenAt < cutoff) {
      entries.shift();
    }
  };

  return {
    add(term: string) {
      prune();
      // Dedup
      const idx = entries.findIndex(
        (e) => e.term.toLowerCase() === term.toLowerCase(),
      );
      if (idx !== -1) {
        entries[idx].seenAt = Date.now();
        return;
      }
      entries.push({ term, seenAt: Date.now() });
      if (entries.length > maxEntries) entries.shift();
    },

    getTerms(): string[] {
      prune();
      return entries.map((e) => e.term);
    },

    clear() {
      entries.length = 0;
    },
  };
};
