import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import autonomyModule from './index';

const bus = createBus();
const client = bus.createClient('autonomy');
const irisDir = join(homedir(), '.iris');

autonomyModule
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
    console.log('[standalone] mod-autonomy running');
    console.log('[standalone] Health:', autonomyModule.getHealth());
  });

process.on('SIGINT', () => autonomyModule.stop().then(() => process.exit(0)));
