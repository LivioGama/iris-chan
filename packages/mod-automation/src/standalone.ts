import { createBus, CH } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import automationModule from './index';

const bus = createBus();
const client = bus.createClient('automation');
const irisDir = join(homedir(), '.iris');

// Mock screen capture handler for standalone mode
bus.handle(CH.SCREEN_CAPTURE, async () => ({
  ok: false,
  data: null,
  error: 'No screen capture in standalone mode',
}));

automationModule
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
    console.log('[standalone] mod-automation running');
    console.log('[standalone] Health:', automationModule.getHealth());
  });

process.on('SIGINT', () => automationModule.stop().then(() => process.exit(0)));
