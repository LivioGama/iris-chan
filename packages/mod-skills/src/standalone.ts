import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import skillsModule from './index';

const bus = createBus();
const client = bus.createClient('skills');
const irisDir = join(homedir(), '.iris');

skillsModule
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
    console.log('[standalone] mod-skills running');
    console.log('[standalone] Health:', skillsModule.getHealth());
  });

process.on('SIGINT', () => skillsModule.stop().then(() => process.exit(0)));
