import { createBus, CH } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import tfaModule from './index';

const bus = createBus();
const client = bus.createClient('2fa');
const irisDir = join(homedir(), '.iris');

// Mock screen capture for standalone mode
bus.handle(CH.SCREEN_CAPTURE, async () => ({
  ok: false,
  data: null,
  error: 'No screen capture in standalone mode',
}));

tfaModule
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
    console.log('[standalone] mod-2fa running');
    console.log('[standalone] Health:', tfaModule.getHealth());
  });

process.on('SIGINT', () => tfaModule.stop().then(() => process.exit(0)));
