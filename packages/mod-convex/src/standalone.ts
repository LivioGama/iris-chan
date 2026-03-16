import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import convexModule from './index';

const bus = createBus();
const client = bus.createClient('convex');
const irisDir = join(homedir(), '.iris');

convexModule
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
    console.log('[standalone] mod-convex running');
    console.log('[standalone] Health:', convexModule.getHealth());
  });

process.on('SIGINT', () => convexModule.stop().then(() => process.exit(0)));
