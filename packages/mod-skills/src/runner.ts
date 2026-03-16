/**
 * Skill runner: spawns skill scripts as child processes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { SkillMetadata } from './scanner';

export interface SkillRunResult {
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

const TIMEOUT_MS = 30_000;

/**
 * Run a skill script and collect its output.
 */
export const runSkill = (
  skill: SkillMetadata,
  args: Record<string, unknown>,
  env: Record<string, string>,
): Promise<SkillRunResult> => {
  return new Promise((resolve) => {
    const startMs = Date.now();
    const entryPath = join(skill.dir, skill.entrypoint);
    const outputChunks: string[] = [];
    const errorChunks: string[] = [];

    // Determine runner based on file extension
    const ext = skill.entrypoint.split('.').pop() ?? '';
    let cmd: string;
    let cmdArgs: string[];

    switch (ext) {
      case 'ts':
        cmd = 'bun';
        cmdArgs = ['run', entryPath];
        break;
      case 'js':
        cmd = 'node';
        cmdArgs = [entryPath];
        break;
      case 'sh':
        cmd = 'bash';
        cmdArgs = [entryPath];
        break;
      default:
        cmd = 'bun';
        cmdArgs = ['run', entryPath];
    }

    const proc = spawn(cmd, cmdArgs, {
      cwd: skill.dir,
      env: {
        ...process.env,
        ...env,
        SKILL_ARGS: JSON.stringify(args),
        SKILL_NAME: skill.name,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        ok: false,
        output: outputChunks.join(''),
        error: `Skill timed out after ${TIMEOUT_MS}ms`,
        durationMs: Date.now() - startMs,
      });
    }, TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => {
      outputChunks.push(chunk.toString());
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk.toString());
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        output: outputChunks.join(''),
        error: code !== 0 ? errorChunks.join('') || `Exit code ${code}` : undefined,
        durationMs: Date.now() - startMs,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        output: outputChunks.join(''),
        error: err.message,
        durationMs: Date.now() - startMs,
      });
    });

    // Send args via stdin
    proc.stdin?.write(JSON.stringify(args));
    proc.stdin?.end();
  });
};
