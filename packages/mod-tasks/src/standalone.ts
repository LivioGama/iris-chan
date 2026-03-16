import { createBus, CH } from '@iris/bus';
import { join } from 'node:path';
import { homedir } from 'node:os';
import tasksModule from './index';

const bus = createBus();
const client = bus.createClient('tasks');
const irisDir = join(homedir(), '.iris');

// Mock Convex for standalone mode
bus.handle(CH.CONVEX_QUERY, async () => ({ ok: true, data: [] }));
bus.handle(CH.CONVEX_SAVE, async () => ({ ok: true }));

// Mock coding module for task execution
bus.subscribe(CH.CODING_TASK_START, (msg: any) => {
  console.log('[standalone] Would execute coding task:', msg.payload.taskId);
  // Simulate completion after 2 seconds
  setTimeout(() => {
    bus.publish(CH.CODING_TASK_DONE, { taskId: msg.payload.taskId, success: true }, 'mock-coding');
  }, 2000);
});

tasksModule
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
    console.log('[standalone] mod-tasks running');
    console.log('[standalone] Health:', tasksModule.getHealth());

    // Test: create a task
    bus.publish(CH.TASK_RUN, { title: 'Test task', prompt: 'Do something useful', priority: 'p1' }, 'test');
  });

process.on('SIGINT', () => tasksModule.stop().then(() => process.exit(0)));
