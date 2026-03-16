import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import voiceModule from './index';

const bus = createBus();
const client = bus.createClient('voice');
const irisDir = join(homedir(), '.iris');

voiceModule
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
    console.log('[standalone] mod-voice running (main-process coordinator)');
    console.log('[standalone] Health:', voiceModule.getHealth());
  });

process.on('SIGINT', () => voiceModule.stop().then(() => process.exit(0)));
