import { createBus } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import geminiModule from './index';

const bus = createBus();
const client = bus.createClient('gemini');
const irisDir = join(homedir(), '.iris');

geminiModule
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
    console.log('[standalone] mod-gemini running (main-process bridge only)');
    console.log('[standalone] Health:', geminiModule.getHealth());
  });

process.on('SIGINT', () => geminiModule.stop().then(() => process.exit(0)));
