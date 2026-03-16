/**
 * CodingRunner: spawns Claude Agent SDK tasks as child processes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export interface CodingTask {
  id: string;
  prompt: string;
  workDir: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: number;
  completedAt?: number;
  output: string[];
  error?: string;
}

export interface CodingRunnerEvents {
  onLog: (taskId: string, line: string) => void;
  onDone: (taskId: string, success: boolean, output: string[]) => void;
}

export class CodingRunner {
  private activeTasks = new Map<string, { task: CodingTask; process: ChildProcess }>();
  private events: CodingRunnerEvents;

  constructor(events: CodingRunnerEvents) {
    this.events = events;
  }

  spawn(id: string, prompt: string, workDir: string, env: Record<string, string>): CodingTask {
    const task: CodingTask = {
      id,
      prompt,
      workDir,
      status: 'running',
      startedAt: Date.now(),
      output: [],
    };

    // Spawn claude CLI as child process
    const proc = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      prompt,
    ], {
      cwd: workDir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        task.output.push(line);
        this.events.onLog(id, line);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        task.output.push(`[stderr] ${line}`);
        this.events.onLog(id, `[stderr] ${line}`);
      }
    });

    proc.on('close', (code) => {
      task.completedAt = Date.now();
      task.status = code === 0 ? 'done' : 'failed';
      if (code !== 0) task.error = `Process exited with code ${code}`;
      this.activeTasks.delete(id);
      this.events.onDone(id, code === 0, task.output);
    });

    proc.on('error', (err) => {
      task.completedAt = Date.now();
      task.status = 'failed';
      task.error = err.message;
      this.activeTasks.delete(id);
      this.events.onDone(id, false, task.output);
    });

    this.activeTasks.set(id, { task, process: proc });
    return task;
  }

  kill(taskId: string): boolean {
    const entry = this.activeTasks.get(taskId);
    if (!entry) return false;
    entry.process.kill('SIGTERM');
    return true;
  }

  getTask(taskId: string): CodingTask | undefined {
    return this.activeTasks.get(taskId)?.task;
  }

  get activeCount(): number {
    return this.activeTasks.size;
  }

  killAll(): void {
    for (const [, entry] of this.activeTasks) {
      entry.process.kill('SIGTERM');
    }
  }
}
