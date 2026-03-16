import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { CH } from '@iris/bus';
import { DEFAULTS } from './defaults';

import manifest from '../manifest.json';

interface ModuleContext {
  bus: import('@iris/bus').BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let data: Record<string, Record<string, unknown>> = {};
let filePath = '';

const load = () => {
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      // Deep merge with defaults
      data = {};
      for (const ns of new Set([...Object.keys(DEFAULTS), ...Object.keys(raw)])) {
        data[ns] = { ...(DEFAULTS[ns] ?? {}), ...(raw[ns] ?? {}) };
      }
    } else {
      data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } catch {
    data = JSON.parse(JSON.stringify(DEFAULTS));
  }
};

const save = () => {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[settings] save failed:', e);
  }
};

export default {
  manifest,

  async start(ctx: ModuleContext) {
    filePath = join(ctx.paths.irisDir, 'settings.json');
    load();
    ctx.logger.info(`Loaded settings from ${filePath}`);

    // Handle settings queries
    ctx.bus.handle<{ namespace: string; key?: string }, unknown>(
      CH.SETTINGS_GET,
      async (payload) => {
        const ns = data[payload.namespace] ?? {};
        if (payload.key) return ns[payload.key];
        return ns;
      },
    );

    // Handle settings updates
    ctx.bus.handle<{ namespace: string; key: string; value: unknown }, void>(
      CH.SETTINGS_UPDATE,
      async (payload) => {
        if (!data[payload.namespace]) data[payload.namespace] = {};
        data[payload.namespace][payload.key] = payload.value;
        save();
        ctx.bus.publish(CH.SETTINGS_CHANGED, {
          namespace: payload.namespace,
          settings: data[payload.namespace],
        });
        ctx.logger.info(`Updated ${payload.namespace}.${payload.key}`);
      },
    );
  },

  async stop() {
    // Bus subscriptions auto-disposed by BusClient
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: { namespaces: Object.keys(data).length },
    };
  },
};
