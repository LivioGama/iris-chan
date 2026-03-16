import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import settingsModule from './index';

const bus = createBus();
const client = bus.createClient('settings');

const irisDir = join(homedir(), '.iris');

settingsModule
  .start({
    bus: client,
    settings: {},
    env: process.env as Record<string, string>,
    paths: {
      irisDir,
      dataDir: join(irisDir, 'data'),
      logsDir: join(irisDir, 'logs'),
      assetsDir: '.',
      projectRoot: '.',
    },
    logger: console,
  })
  .then(() => {
    console.log('[standalone] mod-settings running');
    console.log('[standalone] Health:', settingsModule.getHealth());
  });

process.on('SIGTERM', () => settingsModule.stop());
process.on('SIGINT', () => settingsModule.stop().then(() => process.exit(0)));
