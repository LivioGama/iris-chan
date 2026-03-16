import { createBus, CH } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import searchModule from './index';

const bus = createBus();
const client = bus.createClient('search');
const irisDir = join(homedir(), '.iris');

// Mock Convex for standalone mode
bus.handle(CH.CONVEX_QUERY, async () => []);
bus.handle(CH.CONVEX_SAVE, async () => ({ ok: true }));

searchModule
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
    console.log('[standalone] mod-search running');
    console.log('[standalone] Health:', searchModule.getHealth());

    // Test web search if API key is available
    if (process.env.GEMINI_API_KEY) {
      const result = await bus.request(CH.SEARCH_WEB, { query: 'test' }, 'test');
      console.log('[standalone] Test search result:', result);
    }
  });

process.on('SIGINT', () => searchModule.stop().then(() => process.exit(0)));
