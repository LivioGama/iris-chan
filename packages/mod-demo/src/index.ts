import { CH, type BusClient } from '@iris/bus';
import { DEMO_SCENARIO } from './scenario';
import { createDemoRunner } from './runner';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: {
    irisDir: string;
    dataDir: string;
    logsDir: string;
    assetsDir: string;
    projectRoot: string;
  };
  logger: {
    debug: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
}

let runner: ReturnType<typeof createDemoRunner> | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    runner = createDemoRunner({
      bus: ctx.bus,
      logger: ctx.logger,
      speedMultiplier: parseFloat(ctx.env.IRIS_DEMO_SPEED ?? '1.0'),
    });

    // Register start_demo tool
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'start_demo',
      description:
        'Start the hackathon demo presentation where Iris showcases her capabilities',
      parameters: {
        type: 'OBJECT',
        properties: {
          speed: {
            type: 'NUMBER',
            description:
              'Speed multiplier (0.5 = faster, 1.0 = normal, 2.0 = slower)',
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        if (runner?.isRunning) {
          return { ok: false, result: 'Demo already running' };
        }

        if (args.speed && typeof args.speed === 'number') {
          runner = createDemoRunner({
            bus: ctx.bus,
            logger: ctx.logger,
            speedMultiplier: args.speed,
          });
        }

        // Run asynchronously — don't block the tool response
        runner!.run(DEMO_SCENARIO).catch((err) => {
          ctx.logger.error('Demo failed:', err);
        });

        return {
          ok: true,
          result: `Demo started with ${DEMO_SCENARIO.length} steps. Say "stop demo" to abort.`,
        };
      },
    });

    // Register stop_demo tool
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'stop_demo',
      description: 'Stop the running hackathon demo',
      parameters: { type: 'OBJECT', properties: {} },
      handler: async () => {
        if (!runner?.isRunning) {
          return { ok: false, result: 'No demo running' };
        }
        runner.stop();
        return { ok: true, result: 'Demo stopped' };
      },
    });

    // Also listen for voice command "start demo" / "present yourself"
    ctx.bus.subscribe<{ text: string }>(CH.VOICE_TRANSCRIPT, (msg) => {
      const text = msg.payload.text.toLowerCase();
      if (
        (text.includes('start demo') ||
          text.includes('present yourself') ||
          text.includes('show what you can do') ||
          text.includes('hackathon demo')) &&
        !runner?.isRunning
      ) {
        ctx.logger.info('Demo triggered by voice command');
        runner?.run(DEMO_SCENARIO).catch((err) => {
          ctx.logger.error('Demo failed:', err);
        });
      }

      if (
        (text.includes('stop demo') || text.includes('stop presentation')) &&
        runner?.isRunning
      ) {
        runner.stop();
      }
    });

    ctx.logger.info(
      'Demo module ready — say "present yourself" or call start_demo tool',
    );

    // Auto-launch demo if IRIS_DEMO_AUTO=1
    if (ctx.env.IRIS_DEMO_AUTO === '1') {
      setTimeout(() => {
        ctx.logger.info('Auto-launching demo (IRIS_DEMO_AUTO=1)');
        runner?.run(DEMO_SCENARIO).catch((err) => {
          ctx.logger.error('Demo failed:', err);
        });
      }, 2000); // Wait 2s for all modules to settle
    }
  },

  async stop() {
    runner?.stop();
    runner = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        isRunning: runner?.isRunning ?? false,
        scenarioSteps: DEMO_SCENARIO.length,
      },
    };
  },
};
