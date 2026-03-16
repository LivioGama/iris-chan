import { CH, type BusClient } from '@iris/bus';
import { createVocabStore } from './store';
import { matchTranscript, type MatchResult } from './matcher';
import { createRecentSeenStore } from './recent-seen';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let store: ReturnType<typeof createVocabStore> | null = null;
let recentSeen: ReturnType<typeof createRecentSeenStore> | null = null;
let promoteInterval: ReturnType<typeof setInterval> | null = null;

const PROMOTE_INTERVAL_MS = 60_000;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    store = createVocabStore(ctx.paths.irisDir);
    recentSeen = createRecentSeenStore();

    const termCount = store.getAllTerms().length;
    ctx.logger.info(`Loaded ${termCount} vocabulary terms`);

    // Handle vocab tracking
    ctx.bus.subscribe<{ terms: string[] }>(CH.VOCAB_TRACK, (msg) => {
      if (!store) return;
      for (const term of msg.payload.terms) {
        const added = store.addHotTerm(term);
        if (added) recentSeen?.add(term);
      }
      store.trackTerms(msg.payload.terms);
      ctx.bus.publish(CH.VOCAB_TERMS_UPDATED, {
        recentSeen: recentSeen?.getTerms() ?? [],
      });
    });

    // Handle corrections
    ctx.bus.subscribe<{ wrong: string; right: string }>(
      CH.VOCAB_CORRECTION,
      (msg) => {
        store?.addCorrection(msg.payload.wrong, msg.payload.right);
        ctx.logger.info(
          `Correction added: "${msg.payload.wrong}" → "${msg.payload.right}"`,
        );
      },
    );

    // Handle term queries
    ctx.bus.handle<
      { transcript?: string },
      { terms: string[]; corrections: Record<string, string>; matches: MatchResult[]; recentSeen: string[] }
    >(CH.VOCAB_GET_TERMS, async (payload) => {
      if (!store) {
        return { terms: [], corrections: {}, matches: [], recentSeen: [] };
      }

      const terms = store.getAllTerms();
      const corrections = store.loadCorrections();
      const matches = payload.transcript
        ? matchTranscript(payload.transcript, terms)
        : [];

      return {
        terms,
        corrections,
        matches,
        recentSeen: recentSeen?.getTerms() ?? [],
      };
    });

    // Periodic promote/clean hot terms
    promoteInterval = setInterval(() => {
      if (!store) return;
      const { promoted, expired } = store.promoteAndCleanHot();
      if (promoted.length > 0) {
        ctx.logger.info(`Promoted terms: ${promoted.join(', ')}`);
        ctx.bus.publish(CH.VOCAB_TERMS_UPDATED, {
          promoted,
          recentSeen: recentSeen?.getTerms() ?? [],
        });
      }
      if (expired.length > 0) {
        ctx.logger.debug(`Expired hot terms: ${expired.join(', ')}`);
      }
    }, PROMOTE_INTERVAL_MS);
  },

  async stop() {
    if (promoteInterval) {
      clearInterval(promoteInterval);
      promoteInterval = null;
    }
    store = null;
    recentSeen?.clear();
    recentSeen = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        termCount: store?.getAllTerms().length ?? 0,
        recentSeen: recentSeen?.getTerms().length ?? 0,
      },
    };
  },
};
