import { CH, type BusClient } from '@iris/bus';
import { join } from 'node:path';
import { createGroqClient } from './groq-client';
import { createPatternStore } from './pattern-store';
import { createIntentPredictionEngine } from './intent-prediction';
import { createProactiveEngine } from './proactive-engine';
import { createWorldState } from './world-state';
import { createDailyLoop } from './daily-loop';
import { createGhostPublisher } from './ghost-publisher';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const PREDICTION_POLL_MS = 10_000;

let predictionTimer: ReturnType<typeof setInterval> | null = null;
let dailyLoop: ReturnType<typeof createDailyLoop> | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const groqKey = ctx.env.GROQ_API_KEY;
    if (!groqKey) {
      ctx.logger.warn('No GROQ_API_KEY — intent prediction disabled');
    }

    const groq = createGroqClient({ apiKey: groqKey ?? '', logger: ctx.logger });

    const patternStore = createPatternStore(
      join(ctx.paths.irisDir, 'intent-patterns.json'),
      ctx.logger,
    );

    const predictionEngine = createIntentPredictionEngine(groq, patternStore, ctx.logger);
    const proactiveEngine = createProactiveEngine(ctx.logger);
    const worldState = createWorldState(ctx.bus, ctx.logger);

    // Ghost publisher
    const ghost = createGhostPublisher(
      ctx.env.GHOST_ADMIN_URL ?? '',
      ctx.env.GHOST_ADMIN_KEY ?? '',
      ctx.logger,
    );

    // Daily loop
    dailyLoop = createDailyLoop(
      join(ctx.paths.irisDir, 'daily-loop.json'),
      groq,
      ctx.logger,
    );

    dailyLoop.start(async (draft) => {
      ctx.bus.publish(CH.DAILY_DRAFT_CREATED, draft);

      if (ghost.configured) {
        const result = await ghost.publish(draft.title, draft.markdown);
        if (result.ok) {
          ctx.logger.info(`Ghost draft created: ${result.url}`);
        }
      }
    });

    // Intent prediction poll loop
    if (groqKey) {
      predictionTimer = setInterval(async () => {
        try {
          const context = await worldState.getContext();
          const prediction = await predictionEngine.predict(context);

          if (prediction.confidence >= 0.4) {
            ctx.bus.publish(CH.INTENT_PREDICTION, prediction);
          }

          const suggestions = proactiveEngine.analyze(context);
          for (const suggestion of suggestions) {
            ctx.bus.publish(CH.PROACTIVE_SUGGESTION, suggestion);
          }
        } catch (err) {
          ctx.logger.error('Prediction loop error:', err);
        }
      }, PREDICTION_POLL_MS);

      ctx.logger.info('Intent prediction loop started (10s interval)');
    }

    // Register tool
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'predict_intent',
      description: 'Predict user intent from current screen context',
      parameters: {},
      handler: async () => {
        const context = await worldState.getContext();
        const prediction = await predictionEngine.predict(context);
        return { ok: true, result: prediction };
      },
    });

    ctx.logger.info('Autonomy module started');
  },

  async stop() {
    if (predictionTimer) {
      clearInterval(predictionTimer);
      predictionTimer = null;
    }
    dailyLoop?.stop();
    dailyLoop = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        predictionLoopActive: !!predictionTimer,
        dailyLoop: dailyLoop?.getState() ?? null,
      },
    };
  },
};
