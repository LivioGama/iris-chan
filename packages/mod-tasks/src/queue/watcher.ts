/**
 * Convex watcher: polls Convex for queued tasks and adds them to the local queue.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import type { TaskQueueService, Priority } from './service';

const POLL_INTERVAL_MS = 15_000;

export class TaskWatcher {
  private bus: BusClient;
  private queue: TaskQueueService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenIds = new Set<string>();
  private logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

  constructor(
    bus: BusClient,
    queue: TaskQueueService,
    logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {
    this.bus = bus;
    this.queue = queue;
    this.logger = logger;
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error('Task watcher poll error:', err);
      });
    }, POLL_INTERVAL_MS);

    // Initial poll
    this.poll().catch((err) => this.logger.error('Initial task poll error:', err));
    this.logger.info('Task watcher started (15s interval)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.bus.request<
        { function: string; args: Record<string, unknown> },
        { ok: boolean; data?: Array<{ _id: string; title: string; prompt: string; priority: string; status: string }> }
      >(
        CH.CONVEX_QUERY,
        { function: 'tasks:getQueued', args: { status: 'queued' } },
        10_000,
      );

      if (!result.ok || !result.data) return;

      for (const task of result.data) {
        if (this.seenIds.has(task._id)) continue;
        this.seenIds.add(task._id);

        const priority = (['p0', 'p1', 'p2'].includes(task.priority) ? task.priority : 'p1') as Priority;
        this.queue.enqueue(task.title, task.prompt, priority, { convexId: task._id });
        this.logger.info(`Queued task from Convex: "${task.title}" (${priority})`);

        this.bus.publish(CH.TASK_QUEUE_CHANGED, { action: 'enqueued', taskTitle: task.title });
      }
    } catch {
      // Convex may not be available — silently skip
    }
  }

  get isRunning(): boolean {
    return !!this.timer;
  }
}
