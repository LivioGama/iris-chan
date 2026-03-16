import { CH, type BusClient } from '@iris/bus';
import { VOICE_STATES, DEFAULT_VOICE_CONFIG } from './config';
import manifest from '../manifest.json';

/**
 * mod-voice main process entry.
 *
 * The voice engine, audio capture, and playback run in the RENDERER.
 * This module coordinates voice state with the rest of the system.
 */

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let currentState = VOICE_STATES.IDLE;
let screenCaptureInterval: ReturnType<typeof setInterval> | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    // Track voice state from renderer
    ctx.bus.subscribe<{ state: string; prev: string }>(
      CH.VOICE_STATE_CHANGED,
      (msg) => {
        currentState = msg.payload.state as typeof currentState;
        ctx.logger.debug(`Voice: ${msg.payload.prev} → ${msg.payload.state}`);

        // Update UI status indicators
        ctx.bus.publish(CH.UI_STATUS_UPDATE, {
          voice: currentState !== VOICE_STATES.IDLE,
          think: currentState === VOICE_STATES.PROCESSING,
          speak: currentState === VOICE_STATES.RESPONDING,
          tool: currentState === VOICE_STATES.TOOL_EXECUTING,
        });
      },
    );

    // Barge-in events
    ctx.bus.subscribe(CH.VOICE_BARGE_IN, () => {
      ctx.logger.info('Barge-in detected');
      ctx.bus.publish(CH.UI_TIMELINE_EVENT, {
        type: 'INTERRUPT',
        title: 'Barge-in',
        message: 'User interrupted response',
        timestamp: Date.now(),
      });
    });

    // Transcript events → timeline + bubble
    ctx.bus.subscribe<{ text: string; source: 'user' | 'model' }>(
      CH.VOICE_TRANSCRIPT,
      (msg) => {
        const { text, source } = msg.payload;
        if (text.trim()) {
          ctx.bus.publish(CH.UI_BUBBLE_SHOW, {
            text,
            lane: 'chat',
            role: source === 'user' ? 'user' : 'iris',
          });
        }
      },
    );

    // Periodic screen capture during voice interaction
    const captureIntervalMs =
      DEFAULT_VOICE_CONFIG.screenCaptureInterval;

    screenCaptureInterval = setInterval(() => {
      if (
        currentState !== VOICE_STATES.IDLE &&
        currentState !== VOICE_STATES.TOOL_EXECUTING
      ) {
        ctx.bus.publish(CH.SCREEN_CAPTURE, { reason: 'voice-periodic' });
      }
    }, captureIntervalMs);

    ctx.logger.info('Voice module ready (engine runs in renderer)');
  },

  async stop() {
    if (screenCaptureInterval) {
      clearInterval(screenCaptureInterval);
      screenCaptureInterval = null;
    }
    currentState = VOICE_STATES.IDLE;
  },

  getHealth() {
    return {
      status: (currentState !== VOICE_STATES.IDLE ? 'ok' : 'degraded') as
        | 'ok'
        | 'degraded',
      message:
        currentState === VOICE_STATES.IDLE
          ? 'Voice pipeline not active'
          : undefined,
      details: { state: currentState },
    };
  },
};
