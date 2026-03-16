import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CH, type BusClient } from '@iris/bus';
import manifest from '../manifest.json';

interface FeedbackEntry {
  id: string;
  text: string;
  category: 'voice' | 'preference' | 'behavior' | 'feature-request' | 'general';
  status: 'pending' | 'approved' | 'dismissed';
  createdAt: string;
}

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const CATEGORIES: Record<string, FeedbackEntry['category']> = {
  voice: 'voice',
  speech: 'voice',
  audio: 'voice',
  prefer: 'preference',
  setting: 'preference',
  behavior: 'behavior',
  mode: 'behavior',
  feature: 'feature-request',
  request: 'feature-request',
  add: 'feature-request',
};

const inferCategory = (text: string): FeedbackEntry['category'] => {
  const lower = text.toLowerCase();
  for (const [keyword, cat] of Object.entries(CATEGORIES)) {
    if (lower.includes(keyword)) return cat;
  }
  return 'general';
};

let entries: FeedbackEntry[] = [];
let filePath = '';

const load = () => {
  try {
    if (existsSync(filePath)) {
      entries = JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch {
    entries = [];
  }
};

const save = () => {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(entries, null, 2));
  } catch {}
};

export default {
  manifest,

  async start(ctx: ModuleContext) {
    filePath = join(ctx.paths.irisDir, 'feedback.json');
    load();
    ctx.logger.info(`Loaded ${entries.length} feedback entries`);

    ctx.bus.handle<
      { text: string; category?: string },
      { id: string }
    >(CH.FEEDBACK_ADD, async (payload) => {
      const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry: FeedbackEntry = {
        id,
        text: payload.text,
        category: (payload.category as FeedbackEntry['category']) ?? inferCategory(payload.text),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      entries.push(entry);
      save();
      ctx.bus.publish(CH.FEEDBACK_UPDATED, {
        action: 'added',
        entry,
        pendingCount: entries.filter((e) => e.status === 'pending').length,
      });
      ctx.logger.info(`Feedback added: ${id} (${entry.category})`);
      return { id };
    });
  },

  async stop() {},

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        total: entries.length,
        pending: entries.filter((e) => e.status === 'pending').length,
      },
    };
  },
};
