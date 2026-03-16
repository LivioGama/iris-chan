/**
 * Demo Runner: Executes the demo scenario step-by-step.
 *
 * Each step:
 * 1. Sends narration to Gemini for TTS playback
 * 2. Waits for narration to finish (or partial overlap)
 * 3. Executes the action (tool call, UI task, screen capture)
 * 4. Pauses for the configured duration
 * 5. Emits timeline events and UI updates
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import type { DemoStep, DemoAction } from './scenario';

export interface DemoRunnerOptions {
  bus: BusClient;
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  speedMultiplier?: number; // 1.0 = normal, 0.5 = faster, 2.0 = slower
}

export const createDemoRunner = (opts: DemoRunnerOptions) => {
  const { bus, logger } = opts;
  const speed = opts.speedMultiplier ?? 1.0;
  let running = false;
  let aborted = false;
  let currentStepIndex = 0;

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      if (aborted) return resolve();
      setTimeout(resolve, ms * speed);
    });

  const narrate = async (text: string) => {
    if (!text || aborted) return;

    // Send narration as text to Gemini — it will speak it via TTS
    bus.publish(CH.GEMINI_SEND_TEXT, { text: `[DEMO NARRATION] ${text}` });

    // Also show as chat bubble
    bus.publish(CH.UI_BUBBLE_SHOW, {
      text,
      lane: 'chat',
      role: 'iris',
    });

    // Estimate narration duration (~150ms per word)
    const words = text.split(/\s+/).length;
    const estimatedMs = words * 150;
    await pause(Math.min(estimatedMs, 8000));
  };

  const executeAction = async (action: DemoAction) => {
    if (aborted) return;

    switch (action.type) {
      case 'tool': {
        if (!action.tool) break;
        try {
          const result = await bus.request(
            CH.TOOL_EXECUTE,
            { name: action.tool, args: action.args ?? {} },
            15_000,
          );
          logger.info(`Tool ${action.tool} result:`, result);
        } catch (err) {
          logger.error(`Tool ${action.tool} failed:`, err);
        }
        break;
      }

      case 'ui-task': {
        if (!action.goal) break;
        bus.publish(CH.AUTO_RUN_UI_TASK, { goal: action.goal });
        // Wait for completion or timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 10_000);
          const unsub = bus.subscribe(CH.AUTO_TASK_COMPLETE, () => {
            clearTimeout(timeout);
            unsub();
            resolve();
          });
        });
        break;
      }

      case 'screen-capture': {
        try {
          await bus.request(CH.SCREEN_CAPTURE, { reason: 'demo' }, 5_000);
        } catch {}
        break;
      }

      case 'wait-for-narration': {
        // Just wait — narration handles its own timing
        break;
      }

      case 'text': {
        // Send raw text to Gemini
        if (action.args?.text) {
          bus.publish(CH.GEMINI_SEND_TEXT, { text: action.args.text });
        }
        break;
      }
    }
  };

  const emitPhaseEvent = (step: DemoStep) => {
    bus.publish(CH.UI_TIMELINE_EVENT, {
      type: 'TASK_MILESTONE',
      title: `Demo: ${step.phase}`,
      message: step.narration.slice(0, 80) + (step.narration.length > 80 ? '…' : ''),
      timestamp: Date.now(),
    });
  };

  return {
    async run(steps: DemoStep[]): Promise<void> {
      if (running) {
        logger.info('Demo already running');
        return;
      }

      running = true;
      aborted = false;
      currentStepIndex = 0;

      logger.info(`Starting demo with ${steps.length} steps`);

      // Announce demo start
      bus.publish(CH.UI_TIMELINE_EVENT, {
        type: 'TASK_MILESTONE',
        title: 'Demo Started',
        message: 'Hackathon presentation mode activated',
        timestamp: Date.now(),
      });

      for (let i = 0; i < steps.length; i++) {
        if (aborted) break;
        currentStepIndex = i;
        const step = steps[i];

        logger.info(`[${i + 1}/${steps.length}] ${step.id}: ${step.phase}`);
        emitPhaseEvent(step);

        // Narrate (overlaps with action start)
        await narrate(step.narration);

        // Execute action
        if (step.action) {
          await executeAction(step.action);
        }

        // Pause between steps
        if (step.pauseMs > 0) {
          await pause(step.pauseMs);
        }
      }

      // Announce demo end
      bus.publish(CH.UI_TIMELINE_EVENT, {
        type: 'TASK_DONE',
        title: 'Demo Complete',
        message: 'Hackathon presentation finished',
        timestamp: Date.now(),
      });

      running = false;
      logger.info('Demo completed');
    },

    stop() {
      aborted = true;
      running = false;
      logger.info('Demo stopped');
    },

    get isRunning(): boolean {
      return running;
    },

    get progress(): { current: number; total: number; phase: string } {
      return {
        current: currentStepIndex,
        total: 0, // set by caller
        phase: '',
      };
    },
  };
};
