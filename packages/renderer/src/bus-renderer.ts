declare global {
  interface Window {
    irisBus: {
      send(channel: string, payload: unknown): void;
      on(channel: string, handler: (payload: unknown) => void): () => void;
      invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
    };
  }
}

export type BusHandler<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

const unsubs: Unsubscribe[] = [];

export const rendererBus = {
  send(channel: string, payload: unknown): void {
    window.irisBus.send(channel, payload);
  },

  on<T = unknown>(channel: string, handler: BusHandler<T>): Unsubscribe {
    const unsub = window.irisBus.on(channel, handler as BusHandler);
    unsubs.push(unsub);
    return unsub;
  },

  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
    return window.irisBus.invoke<T>(channel, payload);
  },

  disposeAll(): void {
    for (const unsub of unsubs) unsub();
    unsubs.length = 0;
  },
};
