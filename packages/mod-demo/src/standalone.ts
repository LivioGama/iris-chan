import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import demoModule from './index';

const bus = createBus();
const client = bus.createClient('demo');
const irisDir = join(homedir(), '.iris');

demoModule
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
    console.log('[standalone] mod-demo running');
    console.log('[standalone] Health:', demoModule.getHealth());
    console.log(
      '\nSay "present yourself" or call start_demo to begin the hackathon presentation.',
    );
  });

process.on('SIGINT', () => demoModule.stop().then(() => process.exit(0)));
