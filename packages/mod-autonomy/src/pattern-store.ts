import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface PatternEntry {
  pattern: string;
  hitCount: number;
  missCount: number;
  lastUsed: string;
}

type PatternMap = Record<string, PatternEntry>;

const MAX_ENTRIES = 500;
const PRUNE_THRESHOLD = 30; // days since last use

export const createPatternStore = (
  filePath: string,
  logger: { debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
) => {
  let patterns: PatternMap = {};

  const load = () => {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      patterns = JSON.parse(raw) as PatternMap;
      logger.debug(`Loaded ${Object.keys(patterns).length} intent patterns`);
    } catch {
      patterns = {};
    }
  };

  const save = () => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(patterns, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to save pattern store:', err);
    }
  };

  const record = (pattern: string, outcome: 'hit' | 'miss') => {
    const existing = patterns[pattern] ?? { pattern, hitCount: 0, missCount: 0, lastUsed: '' };
    if (outcome === 'hit') existing.hitCount++;
    else existing.missCount++;
    existing.lastUsed = new Date().toISOString();
    patterns[pattern] = existing;
    save();
  };

  const getAccuracy = (pattern: string): number => {
    const entry = patterns[pattern];
    if (!entry) return 0;
    const total = entry.hitCount + entry.missCount;
    if (total === 0) return 0;
    return entry.hitCount / total;
  };

  const prune = () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PRUNE_THRESHOLD);
    const cutoffStr = cutoff.toISOString();

    const entries = Object.entries(patterns);
    // Remove old + low accuracy entries if over limit
    if (entries.length > MAX_ENTRIES) {
      const sorted = entries.sort(([, a], [, b]) => {
        if (a.lastUsed < cutoffStr && b.lastUsed >= cutoffStr) return -1;
        if (b.lastUsed < cutoffStr && a.lastUsed >= cutoffStr) return 1;
        return a.lastUsed.localeCompare(b.lastUsed);
      });
      patterns = Object.fromEntries(sorted.slice(sorted.length - MAX_ENTRIES));
    }

    // Remove entries not used in PRUNE_THRESHOLD days with low accuracy
    for (const [key, entry] of Object.entries(patterns)) {
      if (entry.lastUsed < cutoffStr) {
        const accuracy = getAccuracy(key);
        if (accuracy < 0.3) delete patterns[key];
      }
    }

    save();
    logger.debug(`Pattern store pruned to ${Object.keys(patterns).length} entries`);
  };

  // Load on creation
  load();

  return { record, getAccuracy, prune, load, save };
};

export type PatternStore = ReturnType<typeof createPatternStore>;
