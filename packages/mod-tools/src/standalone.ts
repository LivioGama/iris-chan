import { createBus, CH } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import toolsModule from './index';

const bus = createBus();
const client = bus.createClient('tools');
const irisDir = join(homedir(), '.iris');

toolsModule
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
  .then(async () => {
    console.log('[standalone] mod-tools running');
    console.log('[standalone] Health:', toolsModule.getHealth());

    // Test tool list
    const result = await bus.request(CH.TOOL_LIST, {}, 'test');
    console.log('[standalone] Tool list:', (result as any).list?.length, 'tools');
  });

process.on('SIGINT', () => toolsModule.stop().then(() => process.exit(0)));
