import { CH, type BusClient } from '@iris/bus';
import manifest from '../manifest.json';

/**
 * mod-gemini main process entry.
 *
 * The actual WebSocket client runs in the RENDERER (WebSocket + WebAudio).
 * This module provides main-process coordination:
 * - Bridges tool calls from renderer to mod-tools
 * - Feeds tool results back to renderer
 * - Manages system prompt assembly
 */

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let connected = false;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    // Bridge tool calls from renderer (Gemini) to mod-tools
    ctx.bus.subscribe<{ id: string; name: string; args: Record<string, unknown> }>(
      CH.GEMINI_TOOL_CALL,
      async (msg) => {
        const { id, name, args } = msg.payload;

        ctx.logger.debug(`Tool call: ${name}(${JSON.stringify(args).slice(0, 100)})`);

        // Execute via mod-tools
        try {
          const result = await ctx.bus.request<
            { name: string; args: Record<string, unknown>; callId: string },
            { ok: boolean; result: unknown; callId?: string }
          >(CH.TOOL_EXECUTE, { name, args, callId: id });

          // Send result back to renderer for Gemini
          ctx.bus.publish(CH.GEMINI_TOOL_RESULT, {
            callId: id,
            name,
            result: result.result,
            ok: result.ok,
          });
        } catch (err) {
          ctx.bus.publish(CH.GEMINI_TOOL_RESULT, {
            callId: id,
            name,
            result: err instanceof Error ? err.message : String(err),
            ok: false,
          });
        }
      },
    );

    // Track connection state
    ctx.bus.subscribe(CH.GEMINI_CONNECTED, () => {
      connected = true;
      ctx.logger.info('Gemini WebSocket connected');
    });

    ctx.bus.subscribe(CH.GEMINI_DISCONNECTED, () => {
      connected = false;
      ctx.logger.warn('Gemini WebSocket disconnected');
    });

    ctx.logger.info('Gemini module ready (client runs in renderer)');
  },

  async stop() {
    connected = false;
  },

  getHealth() {
    return {
      status: connected ? ('ok' as const) : ('degraded' as const),
      message: connected ? undefined : 'WebSocket not connected',
      details: { connected },
    };
  },
};
