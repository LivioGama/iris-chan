import type { ToolRegistry, ToolResult } from './registry';

const SLOW_THRESHOLD_MS = 1200;

export interface ExecutionEvent {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
}

export const createExecutor = (
  registry: ToolRegistry,
  onStart?: (event: ExecutionEvent) => void,
  onEnd?: (event: ExecutionEvent & { result: ToolResult; durationMs: number }) => void,
) => {
  return {
    async execute(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<ToolResult> {
      const tool = registry.get(name);
      if (!tool) {
        return {
          ok: false,
          result: `Unknown tool: "${name}". Available: ${registry.list().map((t) => t.name).join(', ')}`,
        };
      }

      const event: ExecutionEvent = {
        toolName: name,
        args,
        startedAt: Date.now(),
      };

      onStart?.(event);

      try {
        const result = await tool.handler(args);
        const durationMs = Date.now() - event.startedAt;

        if (durationMs > SLOW_THRESHOLD_MS) {
          console.warn(
            `[tools] Slow tool "${name}": ${durationMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`,
          );
        }

        const finalResult = { ...result, durationMs };
        onEnd?.({ ...event, result: finalResult, durationMs });
        return finalResult;
      } catch (err) {
        const durationMs = Date.now() - event.startedAt;
        const errorResult: ToolResult = {
          ok: false,
          result: err instanceof Error ? err.message : String(err),
          durationMs,
        };
        onEnd?.({ ...event, result: errorResult, durationMs });
        return errorResult;
      }
    },
  };
};
