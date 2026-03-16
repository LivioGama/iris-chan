import { contextBridge, ipcRenderer } from 'electron';

const IPC_CHANNEL = 'iris:bus-message';
const IPC_INVOKE = 'iris:bus-invoke';

type Handler = (payload: unknown) => void;
type Unsubscribe = () => void;

const channelHandlers = new Map<string, Set<Handler>>();

// Single listener for all bus messages from main
ipcRenderer.on(IPC_CHANNEL, (_event, msg) => {
  if (!msg?.channel) return;
  const handlers = channelHandlers.get(msg.channel);
  if (handlers) {
    for (const h of handlers) {
      try {
        h(msg.payload);
      } catch (e) {
        console.error(`[irisBus] handler error on "${msg.channel}":`, e);
      }
    }
  }
});

const api = {
  send(channel: string, payload: unknown): void {
    ipcRenderer.send(IPC_CHANNEL, { channel, payload, source: 'renderer' });
  },

  on(channel: string, handler: Handler): Unsubscribe {
    if (!channelHandlers.has(channel)) {
      channelHandlers.set(channel, new Set());
    }
    channelHandlers.get(channel)!.add(handler);
    return () => channelHandlers.get(channel)?.delete(handler);
  },

  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
    return ipcRenderer.invoke(IPC_INVOKE, {
      channel,
      payload,
      source: 'renderer',
    }) as Promise<T>;
  },
};

contextBridge.exposeInMainWorld('irisBus', api);
