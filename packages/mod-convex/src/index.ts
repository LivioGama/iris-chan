import { CH, type BusClient } from '@iris/bus';
import { createConvexClient, type ConvexResult } from './client';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let client: ReturnType<typeof createConvexClient> | null = null;
let connected = false;
let lastError: string | undefined;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const baseUrl =
      ctx.env.CONVEX_URL || ctx.env.CONVEX_SELF_HOSTED_URL || '';
    const adminKey = ctx.env.CONVEX_SELF_HOSTED_ADMIN_KEY;

    if (!baseUrl) {
      ctx.logger.warn('No CONVEX_URL configured — running without database');
      return;
    }

    client = createConvexClient(baseUrl, adminKey);
    ctx.logger.info(`Convex client initialized: ${baseUrl}`);

    // Health check
    const health = await client.query('conversations:getRecent', { limit: 1 });
    connected = health.ok;
    lastError = health.error;

    if (connected) {
      ctx.bus.publish(CH.CONVEX_CONNECTED, { latencyMs: health.latencyMs });
      ctx.logger.info(`Convex connected (${health.latencyMs}ms)`);
    } else {
      ctx.logger.warn(`Convex health check failed: ${health.error}`);
    }

    // Handle save requests
    ctx.bus.handle<
      { function: string; args: Record<string, unknown>; idempotencyKey?: string },
      ConvexResult
    >(CH.CONVEX_SAVE, async (payload) => {
      if (!client) return { ok: false, error: 'No client', latencyMs: 0, retryCount: 0 };
      const args = payload.idempotencyKey
        ? { ...payload.args, idempotencyKey: payload.idempotencyKey }
        : payload.args;
      return client.run(payload.function, args);
    });

    // Handle query requests
    ctx.bus.handle<
      { function: string; args: Record<string, unknown> },
      ConvexResult
    >(CH.CONVEX_QUERY, async (payload) => {
      if (!client) return { ok: false, error: 'No client', latencyMs: 0, retryCount: 0 };
      return client.query(payload.function, payload.args);
    });
  },

  async stop() {
    client = null;
    connected = false;
  },

  getHealth() {
    if (!client) {
      return { status: 'degraded' as const, message: 'No CONVEX_URL configured' };
    }
    return {
      status: connected ? ('ok' as const) : ('error' as const),
      message: lastError,
      details: { connected },
    };
  },
};
