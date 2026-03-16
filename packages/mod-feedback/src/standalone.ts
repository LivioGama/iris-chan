import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import feedbackModule from './index';

const bus = createBus();
const client = bus.createClient('feedback');
const irisDir = join(homedir(), '.iris');

feedbackModule
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
    console.log('[standalone] mod-feedback running');
    console.log('[standalone] Health:', feedbackModule.getHealth());
  });

process.on('SIGINT', () => feedbackModule.stop().then(() => process.exit(0)));
