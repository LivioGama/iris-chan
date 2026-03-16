/**
 * InputMonitor: detects user keyboard/mouse activity during automation.
 * Uses macOS HIDIdleTime from IORegistry to check if the user is actively
 * interacting with the system. If idle < 500ms, user is active -> emit interrupt.
 */

import { execSync } from 'node:child_process';

export interface InputMonitorOptions {
  /** Polling interval in ms (default: 200) */
  pollIntervalMs?: number;
  /** Idle threshold in ms — if idle < this, user is active (default: 500) */
  idleThresholdMs?: number;
}

export type InputCallback = (idleMs: number) => void;

export class InputMonitor {
  private pollIntervalMs: number;
  private idleThresholdMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onActivity: InputCallback | null = null;
  private _interventionDetected = false;
  private _lastActivity = 0;

  constructor(opts: InputMonitorOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 200;
    this.idleThresholdMs = opts.idleThresholdMs ?? 500;
  }

  /**
   * Get the current HID idle time in milliseconds.
   * Returns -1 if unable to read.
   */
  getIdleTimeMs(): number {
    try {
      const raw = execSync('ioreg -c IOHIDSystem | grep HIDIdleTime', {
        encoding: 'utf-8',
        timeout: 2000,
      });
      // Output looks like: "HIDIdleTime" = 123456789 (nanoseconds)
      const match = raw.match(/HIDIdleTime"\s*=\s*(\d+)/);
      if (!match) return -1;
      // Convert nanoseconds to milliseconds
      return Math.floor(parseInt(match[1], 10) / 1_000_000);
    } catch {
      return -1;
    }
  }

  /**
   * Returns true if the user is currently active (idle time below threshold).
   */
  isUserActive(): boolean {
    const idleMs = this.getIdleTimeMs();
    if (idleMs < 0) return false;
    return idleMs < this.idleThresholdMs;
  }

  /**
   * Start monitoring. Calls `onActivity` whenever user activity is detected.
   */
  start(onActivity: InputCallback): void {
    if (this.timer) return;
    this.onActivity = onActivity;
    this._interventionDetected = false;
    this._lastActivity = 0;

    this.timer = setInterval(() => {
      const idleMs = this.getIdleTimeMs();
      if (idleMs >= 0 && idleMs < this.idleThresholdMs) {
        this._interventionDetected = true;
        this._lastActivity = Date.now();
        this.onActivity?.(idleMs);
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onActivity = null;
  }

  /**
   * Reset intervention flag.
   */
  reset(): void {
    this._interventionDetected = false;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  getState() {
    return {
      running: this.timer !== null,
      lastActivity: this._lastActivity,
      interventionDetected: this._interventionDetected,
    };
  }
}
