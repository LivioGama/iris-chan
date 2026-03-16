import { CH, type BusClient } from '@iris/bus';
import { TwoFAOrchestrator } from './orchestrator';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let orchestrator: TwoFAOrchestrator | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const pollMs = 5000; // Could be configured via settings

    orchestrator = new TwoFAOrchestrator(ctx.bus, ctx.logger, pollMs);
    orchestrator.start();

    // Register tool for manual 2FA fill
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'fill_2fa',
      description: 'Detect and fill a 2FA code into the focused field',
      parameters: {},
      handler: async () => {
        if (!orchestrator) return { ok: false, result: 'Orchestrator not running' };
        // Trigger immediate poll
        return { ok: true, result: 'Manual 2FA detection triggered' };
      },
    });

    ctx.logger.info('2FA module started');
  },

  async stop() {
    orchestrator?.stop();
    orchestrator = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: orchestrator?.getHealth() ?? { running: false },
    };
  },
};
