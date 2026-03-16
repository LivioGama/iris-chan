import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import codingModule from './index';

const bus = createBus();
const client = bus.createClient('coding');
const irisDir = join(homedir(), '.iris');

codingModule
  .start({
    bus: client,
    settings: {},
    env: process.env as Record<string, string>,
    paths: {
      irisDir,
      dataDir: join(irisDir, 'data'),
      logsDir: join(irisDir, 'logs'),
      assetsDir: '.',
      projectRoot: process.cwd(),
    },
    logger: console,
  })
  .then(() => {
    console.log('[standalone] mod-coding running');
    console.log('[standalone] Health:', codingModule.getHealth());
  });

process.on('SIGINT', () => codingModule.stop().then(() => process.exit(0)));
