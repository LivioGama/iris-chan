import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;

const POLL_INTERVAL = 5_000;

export interface CapturedLink {
  url: string;
  title: string;
  capturedAt: number;
}

export class LinkCapturePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenUrls = new Set<string>();
  private bus: BusClient;
  private logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

  constructor(
    bus: BusClient,
    logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {
    this.bus = bus;
    this.logger = logger;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL);
    this.logger.info('[link-capture] Poller started (5s interval)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const clipboard = await this.readClipboard();
      if (!clipboard) return;

      const urls = clipboard.match(URL_REGEX);
      if (!urls) return;

      for (const url of urls) {
        if (this.seenUrls.has(url)) continue;
        this.seenUrls.add(url);

        const title = await this.extractTitle(url);
        const link: CapturedLink = { url, title, capturedAt: Date.now() };

        // Store in Convex
        this.bus.publish(CH.CONVEX_SAVE, {
          table: 'links',
          document: { url, title, capturedAt: link.capturedAt },
        });

        // Notify on bus
        this.bus.publish(CH.LINK_CAPTURED, link);
        this.logger.info(`[link-capture] Captured: ${url} — "${title}"`);
      }
    } catch {
      // Silently skip polling errors
    }
  }

  private async readClipboard(): Promise<string> {
    try {
      const { stdout } = await execAsync('pbpaste', { timeout: 2_000 });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async extractTitle(url: string): Promise<string> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'Iris/2.0 LinkCapture' },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok) return url;

      const html = await res.text();
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return match?.[1]?.trim() ?? url;
    } catch {
      return url;
    }
  }
}
