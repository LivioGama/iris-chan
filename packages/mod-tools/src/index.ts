import { CH, type BusClient, type BusMessage } from '@iris/bus';
import { ToolRegistry, type ToolDeclaration, type ToolHandler, type ToolResult } from './registry';
import { createExecutor } from './executor';
import { CORE_DECLARATIONS } from './declarations';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const registry = new ToolRegistry();
let executor: ReturnType<typeof createExecutor> | null = null;
let busRef: BusClient | null = null;

// Track which module owns which tool (for RPC dispatch)
const toolOwners = new Map<string, string>(); // tool name → module name

export default {
  manifest,

  async start(ctx: ModuleContext) {
    busRef = ctx.bus;

    // Create executor with bus event hooks
    executor = createExecutor(
      registry,
      (event) => {
        ctx.bus.publish(CH.TOOL_START, {
          toolName: event.toolName,
          args: event.args,
          startedAt: event.startedAt,
        });
        ctx.bus.publish(CH.UI_TOOL_LOG, {
          id: `${event.toolName}_${event.startedAt}`,
          name: event.toolName,
          detail: summarizeArgs(event.toolName, event.args),
          status: 'running',
        });
      },
      (event) => {
        ctx.bus.publish(CH.TOOL_END, {
          toolName: event.toolName,
          result: event.result,
          durationMs: event.durationMs,
        });
        ctx.bus.publish(CH.UI_TOOL_LOG, {
          id: `${event.toolName}_${event.startedAt}`,
          name: event.toolName,
          status: event.result.ok ? 'success' : 'attention',
        });
      },
    );

    // Register core declarations with RPC dispatch handlers
    for (const decl of CORE_DECLARATIONS) {
      if (!registry.has(decl.name)) {
        registry.register(
          decl,
          createRpcHandler(decl.name, ctx),
          'core-declaration',
        );
      }
    }

    // Listen for tool registrations from other modules.
    // Listen for tool registrations from other modules.
    // If handler is a function (same-process), use it directly.
    // Otherwise, route via per-module RPC channel: tools:execute:{moduleName}
    ctx.bus.subscribe<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      handler?: ToolHandler;
    }>(CH.TOOL_REGISTER, (msg) => {
      const { name, description, parameters, handler } = msg.payload;
      const source = msg.source;
      const decl: ToolDeclaration = {
        name,
        description: description ?? name,
        parameters: (parameters as ToolDeclaration['parameters']) ?? {
          type: 'OBJECT',
          properties: {},
        },
      };

      toolOwners.set(name, source);

      // Use direct handler if it's a real function, otherwise RPC dispatch
      const effectiveHandler =
        typeof handler === 'function'
          ? (handler as ToolHandler)
          : createRpcHandler(name, ctx);

      registry.register(decl, effectiveHandler, source);
      ctx.logger.debug(`Tool registered: ${name} (from ${source}, ${typeof handler === 'function' ? 'direct' : 'rpc'})`);
    });

    // Handle tool execution requests (from Gemini, demo, or other modules)
    ctx.bus.handle<
      { name: string; args?: Record<string, unknown>; callId?: string },
      ToolResult & { callId?: string }
    >(CH.TOOL_EXECUTE, async (payload) => {
      if (!executor) return { ok: false, result: 'Executor not ready' };
      const result = await executor.execute(payload.name, payload.args ?? {});
      return { ...result, callId: payload.callId };
    });

    // Handle tool list requests
    ctx.bus.handle<void, { declarations: ToolDeclaration[]; list: Array<{ name: string; description: string; source: string }> }>(
      CH.TOOL_LIST,
      async () => ({
        declarations: registry.getDeclarations(),
        list: registry.list(),
      }),
    );

    ctx.logger.info(`Tool registry initialized with ${CORE_DECLARATIONS.length} declarations`);
  },

  async stop() {
    executor = null;
    busRef = null;
    toolOwners.clear();
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        registeredTools: registry.size,
        declarations: registry.getDeclarations().length,
      },
    };
  },
};

/**
 * Create an RPC handler that dispatches tool execution to the owning module.
 * Uses a per-module channel: `tools:execute:{moduleName}`
 * Falls back to broadcasting on TOOL_EXECUTE for modules that subscribe to it directly.
 */
const createRpcHandler = (toolName: string, ctx: ModuleContext): ToolHandler => {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const owner = toolOwners.get(toolName);

    if (owner) {
      // Try per-module RPC channel first
      const rpcChannel = `tools:execute:${owner}`;
      try {
        const result = await ctx.bus.request<
          { tool: string; args: Record<string, unknown> },
          ToolResult
        >(rpcChannel, { tool: toolName, args }, 15_000);
        return result;
      } catch {
        // Module doesn't have an RPC handler — fall through
      }
    }

    // Fallback: broadcast on TOOL_EXECUTE and wait for TOOL_RESULT
    return new Promise<ToolResult>((resolve) => {
      const timeout = setTimeout(() => {
        unsub();
        resolve({ ok: false, result: `Tool "${toolName}" timed out (no handler responded)` });
      }, 15_000);

      const unsub = ctx.bus.subscribe<{ tool: string; ok: boolean; result?: unknown; error?: string }>(
        CH.TOOL_RESULT,
        (msg) => {
          if (msg.payload.tool === toolName) {
            clearTimeout(timeout);
            unsub();
            resolve({
              ok: msg.payload.ok,
              result: msg.payload.result ?? msg.payload.error ?? 'No result',
            });
          }
        },
      );

      // Broadcast the execution request
      ctx.bus.publish(CH.TOOL_EXECUTE + ':broadcast', {
        tool: toolName,
        args,
      });
    });
  };
};

const summarizeArgs = (name: string, args: Record<string, unknown>): string => {
  for (const key of ['text', 'path', 'command', 'goal', 'query', 'key', 'name', 'prompt', 'code']) {
    const val = args[key];
    if (typeof val === 'string') {
      return val.length > 50 ? val.slice(0, 50) + '…' : val;
    }
  }
  return '';
};
