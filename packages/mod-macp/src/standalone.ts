import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import macpModule from './index';

const bus = createBus();
const client = bus.createClient('macp');
const irisDir = join(homedir(), '.iris');

macpModule
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
    console.log('[standalone] mod-macp running');
    console.log('[standalone] Health:', macpModule.getHealth());
  });

process.on('SIGINT', () => macpModule.stop().then(() => process.exit(0)));
