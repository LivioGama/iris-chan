import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Bus } from '@iris/bus';
import { CH } from '@iris/bus';
import type { SettingsAccessor } from './types';

export const createSettingsStore = (
  filePath: string,
  bus: Bus,
): SettingsAccessor => {
  let data: Record<string, Record<string, unknown>> = {};
  const changeHandlers = new Map<
    string,
    Set<(settings: Record<string, unknown>) => void>
  >();

  const load = () => {
    try {
      if (existsSync(filePath)) {
        data = JSON.parse(readFileSync(filePath, 'utf-8'));
      }
    } catch {
      data = {};
    }
  };

  const save = () => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[Settings] Failed to save:', e);
    }
  };

  load();

  const notifyChange = (namespace: string) => {
    const ns = data[namespace] ?? {};
    const handlers = changeHandlers.get(namespace);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(ns);
        } catch {}
      }
    }
    bus.publish(CH.SETTINGS_CHANGED, { namespace, settings: ns }, 'core');
  };

  return {
    get<T>(namespace: string, key: string, defaultValue: T): T {
      const ns = data[namespace];
      if (!ns || !(key in ns)) return defaultValue;
      return ns[key] as T;
    },

    getAll(namespace: string): Record<string, unknown> {
      return { ...(data[namespace] ?? {}) };
    },

    set(namespace: string, key: string, value: unknown) {
      if (!data[namespace]) data[namespace] = {};
      data[namespace][key] = value;
      save();
      notifyChange(namespace);
    },

    onChange(
      namespace: string,
      handler: (settings: Record<string, unknown>) => void,
    ) {
      if (!changeHandlers.has(namespace)) {
        changeHandlers.set(namespace, new Set());
      }
      changeHandlers.get(namespace)!.add(handler);
      return () => changeHandlers.get(namespace)?.delete(handler);
    },
  };
};
