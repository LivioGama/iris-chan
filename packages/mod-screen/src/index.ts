import { CH, type BusClient } from '@iris/bus';
import {
  capture,
  getMapping,
  getLatestCaptureId,
  getCaptureHealth,
  getScreenPermissionStatus,
  type CaptureResult,
} from './capture';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const permStatus = getScreenPermissionStatus();
    ctx.logger.info(`Screen capture permission: ${permStatus}`);

    // Handle capture requests
    ctx.bus.handle<
      { reason?: string },
      CaptureResult
    >(CH.SCREEN_CAPTURE, async (payload) => {
      const result = await capture();
      if (result.ok) {
        ctx.bus.publish(CH.SCREEN_CAPTURE_READY, {
          captureId: result.context!.captureId,
          data: result.data,
          context: result.context,
          reason: payload.reason,
        });
      }
      return result;
    });

    // Handle vision requests — delegates to Gemini via bus
    ctx.bus.subscribe<{
      captureId?: string;
      prompt: string;
      data?: string;
    }>(CH.SCREEN_VISION_REQUEST, async (msg) => {
      const { captureId, prompt, data } = msg.payload;

      // Get the image data
      let imageData = data;
      if (!imageData && captureId) {
        // Need to do a fresh capture if no data provided
        const result = await capture();
        if (result.ok) {
          imageData = result.data!;
        }
      }

      if (!imageData) {
        ctx.bus.publish(CH.SCREEN_VISION_RESULT, {
          ok: false,
          error: 'No image data available',
          prompt,
        });
        return;
      }

      // Vision analysis would be done by mod-gemini
      // We publish the request for mod-gemini to handle
      ctx.bus.publish('gemini:vision-analyze', {
        imageData,
        prompt,
        captureId: captureId ?? getLatestCaptureId(),
      });
    });

    // Tool registration for capture_screen
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'capture_screen',
      description: 'Capture a screenshot of the current display',
      parameters: {},
      handler: async () => {
        const result = await capture();
        return result;
      },
    });
  },

  async stop() {},

  getHealth() {
    const health = getCaptureHealth();
    return {
      status: (health.permissionStatus === 'granted' ? 'ok' : 'degraded') as
        | 'ok'
        | 'degraded',
      message:
        health.permissionStatus !== 'granted'
          ? `Screen permission: ${health.permissionStatus}`
          : undefined,
      details: health,
    };
  },
};
