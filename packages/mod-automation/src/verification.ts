/**
 * VerificationEngine: screenshots after action and compares expected vs actual.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';

export interface VerificationResult {
  ok: boolean;
  confidence: number;
  expected: string;
  actual: string;
  screenshotCaptured: boolean;
}

export class VerificationEngine {
  private bus: BusClient;

  constructor(bus: BusClient) {
    this.bus = bus;
  }

  /**
   * Verify a step by capturing a screenshot and analyzing it against expected outcome.
   */
  async verify(expectedOutcome: string, delayMs = 500): Promise<VerificationResult> {
    // Wait for UI to settle after action
    await new Promise((r) => setTimeout(r, delayMs));

    try {
      // Request a screen capture via bus
      const captureResult = await this.bus.request<
        { reason: string },
        { ok: boolean; data?: string; context?: { captureId: string } }
      >(CH.SCREEN_CAPTURE, { reason: `verify: ${expectedOutcome}` });

      if (!captureResult.ok || !captureResult.data) {
        return {
          ok: false,
          confidence: 0,
          expected: expectedOutcome,
          actual: 'Failed to capture screenshot',
          screenshotCaptured: false,
        };
      }

      // Request vision analysis via Gemini
      const visionPrompt = `Analyze this screenshot and determine if the following expected state is true: "${expectedOutcome}".
Reply with JSON: {"match": true/false, "confidence": 0.0-1.0, "description": "what you see"}`;

      // Publish vision request and wait for result
      const analysisPromise = new Promise<{ match: boolean; confidence: number; description: string }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ match: false, confidence: 0.3, description: 'Vision analysis timeout' });
        }, 10_000);

        const unsub = this.bus.subscribe<{ result?: string; error?: string }>(
          CH.SCREEN_VISION_RESULT,
          (msg) => {
            clearTimeout(timeout);
            unsub();
            try {
              const parsed = JSON.parse(msg.payload.result ?? '{}');
              resolve({
                match: parsed.match ?? false,
                confidence: parsed.confidence ?? 0.5,
                description: parsed.description ?? 'Unknown',
              });
            } catch {
              resolve({ match: false, confidence: 0.3, description: msg.payload.result ?? 'Parse error' });
            }
          },
        );
      });

      this.bus.publish(CH.SCREEN_VISION_REQUEST, {
        data: captureResult.data,
        prompt: visionPrompt,
        captureId: captureResult.context?.captureId,
      });

      const analysis = await analysisPromise;

      return {
        ok: analysis.match && analysis.confidence >= 0.6,
        confidence: analysis.confidence,
        expected: expectedOutcome,
        actual: analysis.description,
        screenshotCaptured: true,
      };
    } catch (err) {
      return {
        ok: false,
        confidence: 0,
        expected: expectedOutcome,
        actual: err instanceof Error ? err.message : String(err),
        screenshotCaptured: false,
      };
    }
  }
}
