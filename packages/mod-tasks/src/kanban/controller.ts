/**
 * Kanban controller: CRUD operations for kanban tasks.
 * Maps to Convex backend for persistence.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';

export type KanbanColumn = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  column: KanbanColumn;
  priority: 'p0' | 'p1' | 'p2';
  assignee?: string;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  convexId?: string;
}

export class KanbanController {
  private bus: BusClient;
  private tasks = new Map<string, KanbanTask>();
  private logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

  constructor(
    bus: BusClient,
    logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {
    this.bus = bus;
    this.logger = logger;
  }

  create(data: { title: string; description?: string; column?: KanbanColumn; priority?: 'p0' | 'p1' | 'p2'; labels?: string[] }): KanbanTask {
    const task: KanbanTask = {
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: data.title,
      description: data.description,
      column: data.column ?? 'backlog',
      priority: data.priority ?? 'p1',
      labels: data.labels ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.syncToConvex(task);
    this.publishSync();

    return task;
  }

  update(id: string, changes: Partial<Pick<KanbanTask, 'title' | 'description' | 'column' | 'priority' | 'labels'>>): KanbanTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    Object.assign(task, changes, { updatedAt: Date.now() });
    this.syncToConvex(task);
    this.publishSync();

    return task;
  }

  move(id: string, column: KanbanColumn): KanbanTask | null {
    return this.update(id, { column });
  }

  remove(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) this.publishSync();
    return existed;
  }

  getByColumn(column: KanbanColumn): KanbanTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.column === column)
      .sort((a, b) => {
        // Sort by priority, then creation time
        const priOrder = { p0: 0, p1: 1, p2: 2 };
        const priDiff = priOrder[a.priority] - priOrder[b.priority];
        return priDiff !== 0 ? priDiff : a.createdAt - b.createdAt;
      });
  }

  getAll(): KanbanTask[] {
    return Array.from(this.tasks.values());
  }

  private syncToConvex(task: KanbanTask): void {
    this.bus.publish(CH.CONVEX_SAVE, {
      function: 'kanban:upsert',
      args: {
        localId: task.id,
        title: task.title,
        description: task.description,
        column: task.column,
        priority: task.priority,
        labels: task.labels,
      },
    });
  }

  private publishSync(): void {
    const columns: Record<KanbanColumn, KanbanTask[]> = {
      backlog: this.getByColumn('backlog'),
      todo: this.getByColumn('todo'),
      'in-progress': this.getByColumn('in-progress'),
      review: this.getByColumn('review'),
      done: this.getByColumn('done'),
    };

    this.bus.publish(CH.KANBAN_SYNC, {
      columns,
      totalTasks: this.tasks.size,
      timestamp: Date.now(),
    });
  }

  /**
   * Load tasks from Convex on startup.
   */
  async loadFromConvex(): Promise<void> {
    try {
      const result = await this.bus.request<
        { function: string; args: Record<string, unknown> },
        { ok: boolean; data?: KanbanTask[] }
      >(CH.CONVEX_QUERY, { function: 'kanban:list', args: {} }, 10_000);

      if (result.ok && result.data) {
        for (const task of result.data) {
          this.tasks.set(task.id, task);
        }
        this.logger.info(`Loaded ${result.data.length} kanban tasks from Convex`);
        this.publishSync();
      }
    } catch {
      this.logger.info('Convex not available — kanban running in local mode');
    }
  }
}
