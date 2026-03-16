import { app } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { createBus } from '@iris/bus';
import { createShell } from './shell';
import { createIpcBridge } from './ipc-bridge';
import { createModuleLoader } from './module-loader';
import { createSettingsStore } from './settings-store';
import { ModuleRegistry } from './module-registry';
import { createLogger } from './logger';
import type { IrisPaths } from './types';

// ── Suppress EPIPE ──
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('[FATAL]', err);
});

// ── GPU config ──
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ── Single instance ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Paths ──
const irisDir = join(homedir(), '.iris');
mkdirSync(join(irisDir, 'data'), { recursive: true });
mkdirSync(join(irisDir, 'logs'), { recursive: true });

const paths: IrisPaths = {
  irisDir,
  dataDir: join(irisDir, 'data'),
  logsDir: join(irisDir, 'logs'),
  assetsDir: join(__dirname, '..', '..', '..', 'assets'),
  projectRoot: join(__dirname, '..', '..', '..'),
};

const log = createLogger('core');

app.whenReady().then(async () => {
  log.info('Iris v2 starting...');

  // 1. Create bus
  const bus = createBus();

  // 2. Create settings
  const settings = createSettingsStore(
    join(irisDir, 'settings.json'),
    bus,
  );

  // 3. Create shell (avatar window + tray)
  const shell = await createShell(paths);

  // 4. Bridge IPC
  const ipcBridge = createIpcBridge(bus);
  ipcBridge.addWindow(shell.avatarWindow);

  // 5. Load modules
  const registry = new ModuleRegistry();
  const loader = createModuleLoader(bus, registry, settings, paths);
  await loader.loadAll();

  // 6. Dev mode: watch for changes
  if (process.env.NODE_ENV === 'development') {
    loader.startDevWatcher();
  }

  // ── Cleanup ──
  app.on('will-quit', async () => {
    log.info('Shutting down...');
    await loader.stopAll();
    ipcBridge.dispose();
    shell.dispose();
  });

  log.info('Iris v2 ready');
});

app.on('window-all-closed', () => {
  // Keep alive on macOS
});
