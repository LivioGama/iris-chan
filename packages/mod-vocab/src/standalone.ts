import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import vocabModule from './index';

const bus = createBus();
const client = bus.createClient('vocab');
const irisDir = join(homedir(), '.iris');

vocabModule
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
    console.log('[standalone] mod-vocab running');
    console.log('[standalone] Health:', vocabModule.getHealth());
  });

process.on('SIGINT', () => vocabModule.stop().then(() => process.exit(0)));
