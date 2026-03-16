import { CH, type BusClient } from '@iris/bus';
import { webSearch } from './web-search';
import { semanticSearch } from './semantic-search';
import { LinkCapturePoller } from './link-capture';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let linkPoller: LinkCapturePoller | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const geminiKey = ctx.env.GEMINI_API_KEY ?? ctx.env.GOOGLE_API_KEY ?? '';

    // Handle web search requests
    ctx.bus.handle<{ query: string }, { query: string; text: string; error?: string }>(
      CH.SEARCH_WEB,
      async (payload) => {
        const result = await webSearch(payload.query, geminiKey);
        ctx.bus.publish(CH.SEARCH_RESULT, { type: 'web', ...result });
        return result;
      },
    );

    // Handle semantic search requests
    ctx.bus.handle<
      { query: string; table?: 'observations' | 'links'; limit?: number },
      unknown
    >(CH.SEARCH_SEMANTIC, async (payload) => {
      const results = await semanticSearch(ctx.bus, payload);
      ctx.bus.publish(CH.SEARCH_RESULT, { type: 'semantic', query: payload.query, results });
      return results;
    });

    // Register tools
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'web_search',
      description: 'Search the web using Gemini Flash',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Search query' },
        },
        required: ['query'],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await webSearch(args.query as string, geminiKey);
        return { ok: !result.error, result: result.text || result.error };
      },
    });

    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'recall_link',
      description: 'Recall a previously captured link by semantic search',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'What to search for' },
        },
        required: ['query'],
      },
      handler: async (args: Record<string, unknown>) => {
        const results = await semanticSearch(ctx.bus, {
          query: args.query as string,
          table: 'links',
          limit: 5,
        });
        return { ok: true, result: results };
      },
    });

    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'open_link',
      description: 'Open a URL in the default browser',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING', description: 'URL to open' },
        },
        required: ['url'],
      },
      handler: async (args: Record<string, unknown>) => {
        const { execSync } = await import('node:child_process');
        try {
          execSync(`open "${args.url as string}"`, { timeout: 5000 });
          return { ok: true, result: `Opened ${args.url}` };
        } catch (err) {
          return { ok: false, result: err instanceof Error ? err.message : String(err) };
        }
      },
    });

    // Start link capture poller
    linkPoller = new LinkCapturePoller(ctx.bus, ctx.logger);
    linkPoller.start();

    if (!geminiKey) {
      ctx.logger.warn('No GEMINI_API_KEY — web search disabled');
    }

    ctx.logger.info('Search module started');
  },

  async stop() {
    linkPoller?.stop();
    linkPoller = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        linkPollerActive: !!linkPoller,
      },
    };
  },
};
