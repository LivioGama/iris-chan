import { CH, type BusClient } from '@iris/bus';
import { join } from 'node:path';
import { CodingRunner } from './runner';
import { SelfImprovementManager } from './self-improvement';
import { LearningManager } from './learning-manager';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let runner: CodingRunner | null = null;
let improvement: SelfImprovementManager | null = null;
let learner: LearningManager | null = null;
let taskCounter = 0;

export default {
  manifest,

  async start(ctx: ModuleContext) {
    improvement = new SelfImprovementManager();
    learner = new LearningManager(
      join(ctx.paths.irisDir, 'memory.json'),
      ctx.logger,
    );

    runner = new CodingRunner({
      onLog: (taskId, line) => {
        ctx.bus.publish(CH.CODING_TASK_LOG, { taskId, line, timestamp: Date.now() });
      },
      onDone: (taskId, success, output) => {
        const durationMs = Date.now() - (startTimes.get(taskId) ?? Date.now());
        startTimes.delete(taskId);

        ctx.bus.publish(CH.CODING_TASK_DONE, {
          taskId,
          success,
          outputLines: output.length,
          durationMs,
        });

        // Record for self-improvement
        const prompt = prompts.get(taskId) ?? '';
        prompts.delete(taskId);

        const suggestions = improvement!.recordOutcome({
          taskId,
          prompt,
          success,
          durationMs,
          output,
          error: success ? undefined : output.slice(-5).join('\n'),
        });

        if (suggestions.length > 0) {
          ctx.bus.publish(CH.CODING_SELF_FIX, { taskId, suggestions });
          ctx.logger.info(`Self-improvement suggestions for ${taskId}:`, suggestions);
        }

        ctx.logger.info(`Coding task ${taskId} ${success ? 'completed' : 'failed'} (${(durationMs / 1000).toFixed(1)}s)`);
      },
    });

    const startTimes = new Map<string, number>();
    const prompts = new Map<string, string>();

    // Handle coding task requests
    ctx.bus.subscribe<{
      prompt: string;
      workDir?: string;
      taskId?: string;
    }>(CH.CODING_TASK_START, (msg) => {
      const { prompt, workDir } = msg.payload;
      const taskId = msg.payload.taskId ?? `coding_${Date.now()}_${++taskCounter}`;
      const dir = workDir ?? ctx.paths.projectRoot;

      startTimes.set(taskId, Date.now());
      prompts.set(taskId, prompt);

      // Check for learned patterns to enhance prompt
      const patterns = learner!.findPatterns(prompt);
      let enhancedPrompt = prompt;
      if (patterns.length > 0) {
        const hints = patterns.map((p) => p.response).join('\n');
        enhancedPrompt = `${prompt}\n\nLearned hints:\n${hints}`;
        for (const p of patterns) learner!.usePattern(p.id);
      }

      runner!.spawn(taskId, enhancedPrompt, dir, ctx.env);
      ctx.logger.info(`Spawned coding task ${taskId}: "${prompt.slice(0, 80)}..."`);
    });

    // Handle feedback for learning
    ctx.bus.subscribe<{
      type: 'positive' | 'negative' | 'correction';
      taskId: string;
      detail: string;
      suggestedFix?: string;
    }>(CH.FEEDBACK_ADD, (msg) => {
      learner!.addFeedback(msg.payload);
    });

    // Register tool
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: 'run_coding_task',
      description: 'Spawn a coding task using Claude Agent SDK',
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: { type: 'STRING', description: 'Task prompt' },
          workDir: { type: 'STRING', description: 'Working directory' },
        },
        required: ['prompt'],
      },
      handler: async (args: Record<string, unknown>) => {
        const taskId = `coding_${Date.now()}_${++taskCounter}`;
        const prompt = args.prompt as string;
        const workDir = (args.workDir as string) ?? ctx.paths.projectRoot;

        startTimes.set(taskId, Date.now());
        prompts.set(taskId, prompt);
        runner!.spawn(taskId, prompt, workDir, ctx.env);

        return { ok: true, result: { taskId, status: 'spawned' } };
      },
    });

    ctx.logger.info('Coding module started');
  },

  async stop() {
    runner?.killAll();
    runner = null;
    improvement = null;
    learner = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        activeTasks: runner?.activeCount ?? 0,
        improvement: improvement?.getStats() ?? null,
        learning: learner?.getStats() ?? null,
      },
    };
  },
};
