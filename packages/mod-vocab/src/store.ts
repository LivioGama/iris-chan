import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface HotEntry {
  count: number;
  firstSeen: string;
  lastSeen: string;
}

interface VocabData {
  terms: string[];
  corrections: Record<string, string>;
  core: string[];
}

interface VocabStats {
  [term: string]: { count: number; lastUsed: string };
}

const HOT_PROMOTE_COUNT = 3;
const HOT_EXPIRE_MS = 24 * 60 * 60 * 1000; // 24h

export const createVocabStore = (irisDir: string) => {
  const vocabPath = `${irisDir}/vocabulary.json`;
  const hotPath = `${irisDir}/vocabulary-hot.json`;
  const statsPath = `${irisDir}/vocabulary-stats.json`;

  const ensureDir = () => mkdirSync(dirname(vocabPath), { recursive: true });

  const readJson = <T>(path: string, fallback: T): T => {
    try {
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (path: string, data: unknown) => {
    try {
      ensureDir();
      writeFileSync(path, JSON.stringify(data, null, '\t'));
    } catch {}
  };

  const loadVocab = (): VocabData =>
    readJson(vocabPath, { terms: [], corrections: {}, core: [] });

  const saveVocab = (data: VocabData) => writeJson(vocabPath, data);

  const loadHot = (): Record<string, HotEntry> => readJson(hotPath, {});
  const saveHot = (hot: Record<string, HotEntry>) => writeJson(hotPath, hot);

  const loadStats = (): VocabStats => readJson(statsPath, {});
  const saveStats = (stats: VocabStats) => writeJson(statsPath, stats);

  return {
    loadTerms: (): string[] => loadVocab().terms,
    loadCore: (): string[] => loadVocab().core,
    loadCorrections: (): Record<string, string> => loadVocab().corrections,
    loadHot,

    trackTerms(terms: string[]) {
      const stats = loadStats();
      const now = new Date().toISOString();
      for (const t of terms) {
        if (!stats[t]) stats[t] = { count: 0, lastUsed: now };
        stats[t].count++;
        stats[t].lastUsed = now;
      }
      saveStats(stats);
    },

    addCorrection(wrong: string, right: string) {
      const vocab = loadVocab();
      vocab.corrections[wrong] = right;
      saveVocab(vocab);
    },

    addHotTerm(term: string): boolean {
      const vocab = loadVocab();
      // Skip if already permanent (case-insensitive)
      const lowerPerm = new Set(vocab.terms.map((t) => t.toLowerCase()));
      if (lowerPerm.has(term.toLowerCase())) return false;

      const hot = loadHot();
      const now = new Date().toISOString();

      if (hot[term]) {
        hot[term].count++;
        hot[term].lastSeen = now;
      } else {
        hot[term] = { count: 1, firstSeen: now, lastSeen: now };
      }
      saveHot(hot);
      return true;
    },

    promoteAndCleanHot(): { promoted: string[]; expired: string[] } {
      const vocab = loadVocab();
      const hot = loadHot();
      const now = Date.now();
      const promoted: string[] = [];
      const expired: string[] = [];

      const lowerPerm = new Set(vocab.terms.map((t) => t.toLowerCase()));

      for (const [term, entry] of Object.entries(hot)) {
        const age = now - new Date(entry.lastSeen).getTime();

        if (entry.count >= HOT_PROMOTE_COUNT && !lowerPerm.has(term.toLowerCase())) {
          vocab.terms.push(term);
          lowerPerm.add(term.toLowerCase());
          promoted.push(term);
          delete hot[term];
        } else if (age > HOT_EXPIRE_MS) {
          expired.push(term);
          delete hot[term];
        }
      }

      if (promoted.length > 0) saveVocab(vocab);
      if (promoted.length > 0 || expired.length > 0) saveHot(hot);

      return { promoted, expired };
    },

    getAllTerms(): string[] {
      const vocab = loadVocab();
      const hot = loadHot();
      return [...vocab.terms, ...vocab.core, ...Object.keys(hot)];
    },
  };
};
