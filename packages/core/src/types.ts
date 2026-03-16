import type { BusClient } from '@iris/bus';

// ── Module contract ──

export interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  dependencies: string[];
  provides: Record<string, ToolSchema>;
  channels: {
    publishes: string[];
    subscribes: string[];
  };
  rendererEntry?: string;
  windowEntry?: string;
  standalone?: string;
}

export interface IrisModule {
  manifest: ModuleManifest;
  start(ctx: ModuleContext): Promise<void>;
  stop(): Promise<void>;
  getHealth(): ModuleHealth;
}

export interface ModuleContext {
  bus: BusClient;
  settings: SettingsAccessor;
  env: Record<string, string>;
  paths: IrisPaths;
  logger: Logger;
}

export interface IrisPaths {
  irisDir: string;
  dataDir: string;
  logsDir: string;
  assetsDir: string;
  projectRoot: string;
}

export interface ModuleHealth {
  status: 'ok' | 'degraded' | 'error';
  message?: string;
  details?: Record<string, unknown>;
}

// ── Settings ──

export interface SettingsAccessor {
  get<T>(namespace: string, key: string, defaultValue: T): T;
  getAll(namespace: string): Record<string, unknown>;
  set(namespace: string, key: string, value: unknown): void;
  onChange(
    namespace: string,
    handler: (settings: Record<string, unknown>) => void,
  ): () => void;
}

// ── Tools ──

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
}

export interface ParameterSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

// ── Logger ──

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}
