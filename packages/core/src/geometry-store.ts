import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const createGeometryStore = (filePath: string) => {
  let data: Record<string, WindowBounds> = {};

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
    } catch {}
  };

  load();

  return {
    get(windowId: string): WindowBounds | undefined {
      return data[windowId];
    },

    set(windowId: string, bounds: WindowBounds) {
      data[windowId] = bounds;
      save();
    },
  };
};
