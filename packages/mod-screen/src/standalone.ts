import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import screenModule from './index';

const bus = createBus();
const client = bus.createClient('screen');
const irisDir = join(homedir(), '.iris');

screenModule
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
    console.log('[standalone] mod-screen running');
    console.log('[standalone] Health:', screenModule.getHealth());
  });

process.on('SIGINT', () => screenModule.stop().then(() => process.exit(0)));
