/**
 * Task queue with FIFO ordering and priority lanes (p0/p1/p2).
 */

export type Priority = 'p0' | 'p1' | 'p2';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QueuedTask {
  id: string;
  title: string;
  prompt: string;
  priority: Priority;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const PRIORITY_ORDER: Record<Priority, number> = { p0: 0, p1: 1, p2: 2 };
const MAX_CONCURRENT = 2;

export class TaskQueueService {
  private queues: Map<Priority, QueuedTask[]> = new Map([
    ['p0', []],
    ['p1', []],
    ['p2', []],
  ]);
  private running = new Map<string, QueuedTask>();
  private completed: QueuedTask[] = [];
  private idCounter = 0;
  private onExecute: ((task: QueuedTask) => Promise<void>) | null = null;

  /**
   * Set the execution handler for dequeued tasks.
   */
  setExecutor(handler: (task: QueuedTask) => Promise<void>): void {
    this.onExecute = handler;
  }

  /**
   * Enqueue a new task.
   */
  enqueue(title: string, prompt: string, priority: Priority = 'p1', metadata?: Record<string, unknown>): QueuedTask {
    const task: QueuedTask = {
      id: `task_${Date.now()}_${++this.idCounter}`,
      title,
      prompt,
      priority,
      status: 'queued',
      createdAt: Date.now(),
      metadata,
    };

    this.queues.get(priority)!.push(task);
    this.tryDequeue();
    return task;
  }

  /**
   * Try to dequeue and execute the next highest-priority task.
   */
  private tryDequeue(): void {
    if (this.running.size >= MAX_CONCURRENT) return;
    if (!this.onExecute) return;

    // Find the highest-priority non-empty queue
    for (const priority of ['p0', 'p1', 'p2'] as Priority[]) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        const task = queue.shift()!;
        task.status = 'running';
        task.startedAt = Date.now();
        this.running.set(task.id, task);

        this.onExecute(task)
          .then(() => this.completeTask(task.id, true))
          .catch((err) => this.completeTask(task.id, false, err instanceof Error ? err.message : String(err)));

        // Try to fill remaining slots
        if (this.running.size < MAX_CONCURRENT) {
          this.tryDequeue();
        }
        return;
      }
    }
  }

  /**
   * Mark a task as completed or failed.
   */
  completeTask(taskId: string, success: boolean, error?: string, result?: string): void {
    const task = this.running.get(taskId);
    if (!task) return;

    task.status = success ? 'done' : 'failed';
    task.completedAt = Date.now();
    task.error = error;
    task.result = result;

    this.running.delete(taskId);
    this.completed.push(task);

    // Trim completed history
    if (this.completed.length > 200) {
      this.completed = this.completed.slice(-100);
    }

    // Try to dequeue next task
    this.tryDequeue();
  }

  /**
   * Cancel a queued task.
   */
  cancel(taskId: string): boolean {
    for (const queue of this.queues.values()) {
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        queue[idx].status = 'cancelled';
        queue[idx].completedAt = Date.now();
        this.completed.push(queue[idx]);
        queue.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  getTask(taskId: string): QueuedTask | undefined {
    // Check running
    const running = this.running.get(taskId);
    if (running) return running;

    // Check queues
    for (const queue of this.queues.values()) {
      const task = queue.find((t) => t.id === taskId);
      if (task) return task;
    }

    // Check completed
    return this.completed.find((t) => t.id === taskId);
  }

  getStats() {
    let queuedCount = 0;
    for (const queue of this.queues.values()) queuedCount += queue.length;

    return {
      queued: queuedCount,
      running: this.running.size,
      completed: this.completed.filter((t) => t.status === 'done').length,
      failed: this.completed.filter((t) => t.status === 'failed').length,
    };
  }

  getAllTasks(): QueuedTask[] {
    const all: QueuedTask[] = [];
    for (const queue of this.queues.values()) all.push(...queue);
    all.push(...this.running.values());
    all.push(...this.completed.slice(-20));
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
}
