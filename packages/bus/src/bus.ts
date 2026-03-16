import { Emitter } from './emitter';
import type { Bus, BusClient, BusMessage } from './protocol';

const DEFAULT_TIMEOUT = 10_000;

export const createBus = (): Bus => {
  const emitter = new Emitter();
  const handlers = new Map<
    string,
    (payload: unknown, msg: BusMessage) => Promise<unknown>
  >();

  const buildMessage = <T>(
    channel: string,
    payload: T,
    source: string,
    correlationId?: string,
  ): BusMessage<T> => ({
    channel,
    payload,
    source,
    timestamp: Date.now(),
    correlationId,
  });

  const bus: Bus = {
    publish<T>(channel: string, payload: T, source: string) {
      const msg = buildMessage(channel, payload, source);
      emitter.emit(channel, msg);
    },

    subscribe<T>(
      channel: string,
      handler: (msg: BusMessage<T>) => void,
    ): () => void {
      return emitter.on(channel, handler as (...args: unknown[]) => void);
    },

    subscribeAll(handler: (msg: BusMessage) => void): () => void {
      return emitter.onAll((_event: unknown, msg: unknown) => {
        handler(msg as BusMessage);
      });
    },

    request<TReq, TRes>(
      channel: string,
      payload: TReq,
      source: string,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<TRes> {
      const handler = handlers.get(channel);
      if (!handler) {
        return Promise.reject(
          new Error(`No handler registered for channel "${channel}"`),
        );
      }
      const msg = buildMessage(channel, payload, source);

      return Promise.race([
        handler(payload, msg) as Promise<TRes>,
        new Promise<TRes>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Request timeout on "${channel}"`)),
            timeoutMs,
          ),
        ),
      ]);
    },

    handle<TReq, TRes>(
      channel: string,
      handler: (payload: TReq, msg: BusMessage<TReq>) => Promise<TRes>,
    ): () => void {
      if (handlers.has(channel)) {
        console.warn(
          `[Bus] Overwriting handler for "${channel}" — only one handler allowed per channel`,
        );
      }
      handlers.set(
        channel,
        handler as (payload: unknown, msg: BusMessage) => Promise<unknown>,
      );
      return () => handlers.delete(channel);
    },

    createClient(moduleName: string): BusClient {
      const unsubs: (() => void)[] = [];

      const client: BusClient = {
        moduleName,

        publish<T>(channel: string, payload: T) {
          bus.publish(channel, payload, moduleName);
        },

        subscribe<T>(
          channel: string,
          handler: (msg: BusMessage<T>) => void,
        ) {
          const unsub = bus.subscribe(channel, handler);
          unsubs.push(unsub);
          return unsub;
        },

        request<TReq, TRes>(
          channel: string,
          payload: TReq,
          timeoutMs?: number,
        ) {
          return bus.request<TReq, TRes>(
            channel,
            payload,
            moduleName,
            timeoutMs,
          );
        },

        handle<TReq, TRes>(
          channel: string,
          handler: (
            payload: TReq,
            msg: BusMessage<TReq>,
          ) => Promise<TRes>,
        ) {
          const unsub = bus.handle(channel, handler);
          unsubs.push(unsub);
          return unsub;
        },

        dispose() {
          for (const unsub of unsubs) unsub();
          unsubs.length = 0;
        },
      };

      return client;
    },
  };

  return bus;
};
