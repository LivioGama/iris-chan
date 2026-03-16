import { CH, type BusClient } from '@iris/bus';
import { TaskQueueService } from './queue/service';
import { KanbanController } from './kanban/controller';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let queue: TaskQueueService | null = null;
let kanban: KanbanController | null = null;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    queue = new TaskQueueService();
    kanban = new KanbanController(ctx.paths.irisDir, ctx.bus);

    // Set executor: delegate to coding module
    queue.setExecutor(async (task) => {
      ctx.bus.publish(CH.CODING_TASK_START, {
        taskId: task.id,
        prompt: task.prompt,
        metadata: task.metadata,
      });
    });

    // Handle task creation
    ctx.bus.subscribe<{ title: string; prompt: string; priority?: string }>(
      CH.TASK_CREATED,
      (msg) => {
        if (!queue) return;
        const task = queue.enqueue(
          msg.payload.title,
          msg.payload.prompt,
          (msg.payload.priority as 'p0' | 'p1' | 'p2') ?? 'p1',
        );
        ctx.logger.info(`Task enqueued: ${task.id}`);
        ctx.bus.publish(CH.TASK_QUEUE_CHANGED, { action: 'enqueued', taskId: task.id });
      },
    );

    // Handle task stop
    ctx.bus.subscribe<{ taskId: string }>(CH.TASK_STOP, (msg) => {
      queue?.cancel(msg.payload.taskId);
    });

    // Handle coding task completion
    ctx.bus.subscribe<{ taskId: string; result?: string; error?: string }>(
      CH.CODING_TASK_DONE,
      (msg) => {
        if (!queue) return;
        const { taskId, result, error } = msg.payload;
        queue.completeTask(taskId, !error, error, result);
        ctx.bus.publish(CH.TASK_MILESTONE, {
          taskId,
          milestone: error ? 'failed' : 'completed',
          timestamp: Date.now(),
        });
      },
    );

    // Handle kanban sync
    ctx.bus.handle(CH.KANBAN_SYNC, async () => {
      return kanban?.getAll() ?? { todo: [], 'in-progress': [], done: [] };
    });

    // Register add_task tool
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'add_task',
      description: 'Add a task to the autonomous task queue',
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: { type: 'STRING', description: 'Task description' },
          priority: { type: 'STRING', description: 'Priority', enum: ['p0', 'p1', 'p2'] },
        },
        required: ['prompt'],
      },
      handler: async (args: Record<string, unknown>) => {
        if (!queue) return { ok: false, result: 'Queue not ready' };
        const task = queue.enqueue(
          (args.prompt as string).slice(0, 80),
          args.prompt as string,
          (args.priority as 'p0' | 'p1' | 'p2') ?? 'p1',
        );
        return { ok: true, result: `Task ${task.id} enqueued (${task.priority})` };
      },
    });

    ctx.logger.info(`Tasks module started (${queue.getStats().queued} queued)`);
  },

  async stop() {
    queue = null;
    kanban = null;
  },

  getHealth() {
    const stats = queue?.getStats();
    return {
      status: 'ok' as const,
      details: stats ?? { queued: 0, running: 0, completed: 0, failed: 0 },
    };
  },
};
