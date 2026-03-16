export interface BusMessage<T = unknown> {
  channel: string;
  payload: T;
  source: string;
  timestamp: number;
  correlationId?: string;
}

export interface BusClient {
  readonly moduleName: string;

  publish<T>(channel: string, payload: T): void;

  subscribe<T>(
    channel: string,
    handler: (msg: BusMessage<T>) => void,
  ): () => void;

  request<TReq, TRes>(
    channel: string,
    payload: TReq,
    timeoutMs?: number,
  ): Promise<TRes>;

  handle<TReq, TRes>(
    channel: string,
    handler: (payload: TReq, msg: BusMessage<TReq>) => Promise<TRes>,
  ): () => void;

  dispose(): void;
}

export interface Bus {
  publish<T>(channel: string, payload: T, source: string): void;

  subscribe<T>(
    channel: string,
    handler: (msg: BusMessage<T>) => void,
  ): () => void;

  subscribeAll(handler: (msg: BusMessage) => void): () => void;

  request<TReq, TRes>(
    channel: string,
    payload: TReq,
    source: string,
    timeoutMs?: number,
  ): Promise<TRes>;

  handle<TReq, TRes>(
    channel: string,
    handler: (payload: TReq, msg: BusMessage<TReq>) => Promise<TRes>,
  ): () => void;

  createClient(moduleName: string): BusClient;
}
