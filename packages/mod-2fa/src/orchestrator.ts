/**
 * TwoFAOrchestrator: poll loop that detects 2FA fields,
 * gathers codes from sources, scores confidence, and fills.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import { detectField, type FieldDetection } from './detector';
import { CodeCache } from './code-cache';
import { scoreCode, pickBestCode, type ConfidenceResult } from './confidence';
import { fillCode } from './fill';
import { readIMessageCodes } from './sources/imessage';
import { readNotifications } from './sources/notifications';

const DEFAULT_POLL_MS = 5000;
const MIN_FILL_CONFIDENCE = 0.6;

export class TwoFAOrchestrator {
  private bus: BusClient;
  private cache: CodeCache;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollMs: number;
  private logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  private fillCount = 0;
  private detectCount = 0;
  private lastFieldDetection: FieldDetection | null = null;

  constructor(
    bus: BusClient,
    logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
    pollMs = DEFAULT_POLL_MS,
  ) {
    this.bus = bus;
    this.logger = logger;
    this.pollMs = pollMs;
    this.cache = new CodeCache();
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error('2FA poll error:', err);
      });
    }, this.pollMs);

    this.logger.info(`2FA orchestrator started (${this.pollMs}ms interval)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    // Step 1: Gather codes from all sources (regardless of field state)
    this.gatherCodes();

    // Step 2: Detect if a 2FA field is focused
    const field = await detectField(this.bus);
    this.lastFieldDetection = field;

    if (!field.detected) return;

    this.detectCount++;
    this.bus.publish(CH.TFA_FIELD_DETECTED, {
      fieldType: field.fieldType,
      service: field.service,
      confidence: field.confidence,
    });

    this.logger.info(`2FA field detected: ${field.fieldType} (${(field.confidence * 100).toFixed(0)}%)`);

    // Step 3: Find best code from cache
    const cached = this.cache.getAll();
    if (cached.length === 0) {
      this.bus.publish(CH.TFA_NO_CODE, { fieldType: field.fieldType });
      this.logger.debug('No codes available in cache');
      return;
    }

    // Score all cached codes
    const scored: ConfidenceResult[] = cached.map((c) =>
      scoreCode(c.code, `${c.source} ${field.service ?? ''} ${field.fieldType}`),
    );

    const best = pickBestCode(scored);
    if (!best) {
      this.bus.publish(CH.TFA_NO_CODE, { fieldType: field.fieldType });
      return;
    }

    // Step 4: Check confidence threshold
    if (best.score < MIN_FILL_CONFIDENCE) {
      this.bus.publish(CH.TFA_LOW_CONFIDENCE, {
        code: best.code,
        score: best.score,
        reasons: best.reasons,
      });
      this.logger.debug(`Code ${best.code} confidence too low: ${best.score}`);
      return;
    }

    // Step 5: Fill the code
    this.bus.publish(CH.TFA_FILL_START, { code: best.code, score: best.score });

    const result = await fillCode(best.code, this.bus);

    if (result.ok) {
      this.fillCount++;
      this.cache.remove(best.code); // Don't reuse the same code
      this.bus.publish(CH.TFA_FILL_SUCCESS, {
        code: best.code,
        method: result.method,
        score: best.score,
      });
      this.logger.info(`2FA code filled: ${best.code.slice(0, 2)}**** via ${result.method}`);
    } else {
      this.bus.publish(CH.TFA_FILL_FAILED, {
        code: best.code,
        error: result.error,
      });
      this.logger.warn('2FA fill failed:', result.error);
    }
  }

  /**
   * Gather codes from iMessage and notifications, add to cache.
   */
  private gatherCodes(): void {
    // iMessage codes
    try {
      const imsgCodes = readIMessageCodes(5);
      for (const code of imsgCodes) {
        if (!this.cache.has(code.code)) {
          this.cache.add(code.code, 'imessage', code.sender);
          this.bus.publish(CH.TFA_CODE_CACHED, {
            code: code.code,
            source: 'imessage',
            sender: code.sender,
          });
        }
      }
    } catch {
      // Silently handle iMessage errors
    }

    // Notification codes
    try {
      const notifCodes = readNotifications();
      for (const code of notifCodes) {
        if (!this.cache.has(code.code)) {
          this.cache.add(code.code, 'notification', code.appName);
          this.bus.publish(CH.TFA_CODE_CACHED, {
            code: code.code,
            source: 'notification',
            app: code.appName,
          });
        }
      }
    } catch {
      // Silently handle notification errors
    }
  }

  getHealth() {
    return {
      running: !!this.timer,
      cachedCodes: this.cache.size,
      fillCount: this.fillCount,
      detectCount: this.detectCount,
      lastDetection: this.lastFieldDetection,
    };
  }
}
