/**
 * MACP (Multi-Agent Coordination Protocol) module.
 * Joins channels, polls for messages, dispatches tasks.
 */

import { CH, type BusClient } from '@iris/bus';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

interface MACPMessage {
  id: string;
  from: string;
  channel?: string;
  content: string;
  timestamp: number;
  type: 'message' | 'task' | 'ack' | 'status';
}

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_PROJECT_ID = 'iris-chan';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let agentId = '';
let registered = false;
let messageCount = 0;
let lastPollAt = 0;

const buildHeaders = (apiKey: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const macpUrl = ctx.env.MACP_URL ?? ctx.env.MACP_SERVER_URL ?? '';
    const macpKey = ctx.env.MACP_API_KEY ?? '';
    const projectId = ctx.env.MACP_PROJECT_ID ?? DEFAULT_PROJECT_ID;

    if (!macpUrl) {
      ctx.logger.info('No MACP_URL configured — MACP module in passive mode');
      return;
    }

    // Register agent
    try {
      const res = await fetch(`${macpUrl}/api/agents/register`, {
        method: 'POST',
        headers: buildHeaders(macpKey),
        body: JSON.stringify({
          name: 'iris-v2',
          projectId,
          capabilities: ['coding', 'automation', 'search'],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { agentId: string };
        agentId = data.agentId;
        registered = true;
        ctx.logger.info(`MACP registered as ${agentId}`);
      } else {
        ctx.logger.warn(`MACP registration failed: ${res.status}`);
      }
    } catch (err) {
      ctx.logger.warn('MACP registration error:', err);
    }

    // Join default channel
    if (registered) {
      try {
        await fetch(`${macpUrl}/api/channels/${projectId}/join`, {
          method: 'POST',
          headers: buildHeaders(macpKey),
          body: JSON.stringify({ agentId }),
        });
        ctx.logger.info(`MACP joined channel: ${projectId}`);
      } catch {
        // Channel join is best-effort
      }
    }

    // Poll for messages
    pollTimer = setInterval(async () => {
      if (!registered) return;
      lastPollAt = Date.now();

      try {
        const res = await fetch(`${macpUrl}/api/agents/${agentId}/poll`, {
          method: 'GET',
          headers: buildHeaders(macpKey),
        });

        if (!res.ok) return;

        const data = (await res.json()) as { messages: MACPMessage[] };

        for (const msg of data.messages ?? []) {
          messageCount++;
          ctx.bus.publish(CH.MACP_MESSAGE, {
            id: msg.id,
            from: msg.from,
            channel: msg.channel,
            content: msg.content,
            type: msg.type,
            timestamp: msg.timestamp,
          });

          // Handle task dispatches
          if (msg.type === 'task') {
            ctx.bus.publish(CH.MACP_TASK_DISPATCHED, {
              taskId: msg.id,
              from: msg.from,
              content: msg.content,
            });

            // Forward to task queue
            ctx.bus.publish(CH.TASK_RUN, {
              title: `MACP: ${msg.content.slice(0, 80)}`,
              prompt: msg.content,
              priority: 'p1',
            });
          }

          // Acknowledge receipt
          try {
            await fetch(`${macpUrl}/api/messages/${msg.id}/ack`, {
              method: 'POST',
              headers: buildHeaders(macpKey),
              body: JSON.stringify({ agentId }),
            });
          } catch {
            // Ack is best-effort
          }
        }
      } catch {
        // Polling errors are expected if server is unreachable
      }
    }, POLL_INTERVAL_MS);

    // Send message handler
    ctx.bus.subscribe<{ channel?: string; to?: string; content: string; type?: string }>(
      'macp:send',
      async (msg) => {
        if (!registered || !macpUrl) return;

        const endpoint = msg.payload.to
          ? `${macpUrl}/api/messages/direct`
          : `${macpUrl}/api/channels/${msg.payload.channel ?? projectId}/send`;

        try {
          await fetch(endpoint, {
            method: 'POST',
            headers: buildHeaders(macpKey),
            body: JSON.stringify({
              agentId,
              to: msg.payload.to,
              content: msg.payload.content,
              type: msg.payload.type ?? 'message',
            }),
          });
        } catch (err) {
          ctx.logger.warn('MACP send failed:', err);
        }
      },
    );

    ctx.logger.info('MACP module started');
  },

  async stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    registered = false;
  },

  getHealth() {
    return {
      status: registered ? ('ok' as const) : ('degraded' as const),
      message: registered ? undefined : 'Not registered with MACP server',
      details: {
        registered,
        agentId: agentId || null,
        messageCount,
        lastPollAt,
      },
    };
  },
};
