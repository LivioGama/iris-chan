import { ipcMain, type BrowserWindow } from 'electron';
import type { Bus } from '@iris/bus';

const IPC_CHANNEL = 'iris:bus-message';
const IPC_INVOKE = 'iris:bus-invoke';

export const createIpcBridge = (bus: Bus) => {
  const windows = new Set<BrowserWindow>();

  // Renderer → Main: forward to bus
  ipcMain.on(IPC_CHANNEL, (_event, msg) => {
    if (msg?.channel && msg.payload !== undefined) {
      bus.publish(msg.channel, msg.payload, msg.source ?? 'renderer');
    }
  });

  // Renderer → Main: request/reply
  ipcMain.handle(IPC_INVOKE, async (_event, msg) => {
    if (!msg?.channel) return null;
    return bus.request(msg.channel, msg.payload, msg.source ?? 'renderer');
  });

  // Strip non-serializable values (functions, circular refs) before IPC
  const safeSerialize = (obj: unknown): unknown => {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return null;
    }
  };

  // Main → Renderer: forward bus messages to all registered windows
  const unsubAll = bus.subscribeAll((msg) => {
    // Skip messages with non-serializable payloads (e.g. tool handler functions)
    const safe = safeSerialize(msg);
    if (!safe) return;

    for (const win of windows) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(IPC_CHANNEL, safe);
        } catch {
          // Ignore serialization failures
        }
      }
    }
  });

  return {
    addWindow(win: BrowserWindow): void {
      windows.add(win);
      win.on('closed', () => windows.delete(win));
    },

    removeWindow(win: BrowserWindow): void {
      windows.delete(win);
    },

    dispose(): void {
      unsubAll();
      ipcMain.removeAllListeners(IPC_CHANNEL);
      ipcMain.removeHandler(IPC_INVOKE);
      windows.clear();
    },
  };
};
