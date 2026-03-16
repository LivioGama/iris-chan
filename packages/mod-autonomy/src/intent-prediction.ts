import type { GroqClient } from './groq-client';
import type { PatternStore } from './pattern-store';

interface LRUEntry<T> {
  value: T;
  expiresAt: number;
}

interface Prediction {
  id: string;
  intents: string[];
  confidence: number;
  toolHints: string[];
  timestamp: number;
}

interface PredictionContext {
  frontmostApp: string;
  windowTitle: string;
  timeOfDay: string;
  gitBranch?: string;
  workspace?: string;
}

const LRU_MAX = 50;
const LRU_TTL_MS = 5 * 60 * 1000; // 5 minutes

const buildCacheKey = (ctx: PredictionContext): string =>
  `${ctx.frontmostApp}::${ctx.windowTitle}::${ctx.timeOfDay}`;

let idCounter = 0;
const nextId = (): string => `pred_${Date.now()}_${++idCounter}`;

export const createIntentPredictionEngine = (
  groq: GroqClient,
  patternStore: PatternStore,
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void },
) => {
  const cache = new Map<string, LRUEntry<Prediction>>();

  const evictExpired = () => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  };

  const evictLRU = () => {
    if (cache.size <= LRU_MAX) return;
    // Remove oldest entry
    const firstKey = cache.keys().next().value as string;
    cache.delete(firstKey);
  };

  const predict = async (context: PredictionContext): Promise<Prediction> => {
    evictExpired();

    const key = buildCacheKey(context);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Move to end (LRU refresh)
      cache.delete(key);
      cache.set(key, cached);
      logger.debug('Intent cache hit:', key);
      return cached.value;
    }

    const text = `App: ${context.frontmostApp}, Window: ${context.windowTitle}`;
    const result = await groq.classify(text, context as unknown as Record<string, unknown>);

    const prediction: Prediction = {
      id: nextId(),
      intents: result.intents,
      confidence: result.confidence,
      toolHints: result.toolHints,
      timestamp: Date.now(),
    };

    cache.set(key, { value: prediction, expiresAt: Date.now() + LRU_TTL_MS });
    evictLRU();

    logger.info(`Intent predicted: ${result.intents.join(', ')} (${(result.confidence * 100).toFixed(0)}%)`);
    return prediction;
  };

  const trackOutcome = (predictionId: string, hit: boolean) => {
    // Find prediction in cache by id
    for (const entry of cache.values()) {
      if (entry.value.id === predictionId) {
        const pattern = entry.value.intents.join(',');
        patternStore.record(pattern, hit ? 'hit' : 'miss');
        logger.debug(`Outcome tracked: ${predictionId} → ${hit ? 'hit' : 'miss'}`);
        return;
      }
    }
    logger.debug(`Prediction ${predictionId} not found in cache for outcome tracking`);
  };

  return { predict, trackOutcome };
};

export type IntentPredictionEngine = ReturnType<typeof createIntentPredictionEngine>;
