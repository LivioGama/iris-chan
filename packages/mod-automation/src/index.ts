import { CH, type BusClient } from '@iris/bus';
import { PlanningEngine, type Plan, type PlanStep } from './planner';
import { routeStep, executeStep, type ExecutionResult } from './execution-policy';
import { VerificationEngine } from './verification';
import { InputMonitor } from './input-monitor';
import {
  nativeClick,
  nativeDoubleClick,
  nativeType,
  nativeDrag,
  nativeScroll,
  nativeKeyCombo,
  activateApp,
  getFrontmostApp,
  getFrontmostWindowTitle,
} from './native/actions';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const planner = new PlanningEngine();
let verifier: VerificationEngine | null = null;
const inputMonitor = new InputMonitor({ pollIntervalMs: 200, idleThresholdMs: 500 });
let activeTask: { id: string; plan: Plan; aborted: boolean; startedAt: number; currentStep: number } | null = null;
let ctx: ModuleContext | null = null;
let tasksCompleted = 0;
let tasksFailed = 0;

const generateTaskId = () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const tryGetFrontApp = (): string | undefined => {
  try {
    return getFrontmostApp();
  } catch {
    return undefined;
  }
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runTask = async (goal: string, app?: string, providedId?: string): Promise<void> => {
  if (!ctx) return;
  if (activeTask) {
    ctx.logger.warn(`[automation] Already running task ${activeTask.id}, rejecting new request`);
    ctx.bus.publish(CH.AUTO_TASK_FAILED, {
      taskId: providedId ?? 'unknown',
      reason: 'busy',
      message: `Already running task ${activeTask.id}`,
    });
    return;
  }

  const taskId = providedId ?? generateTaskId();
  const plan = planner.createPlan(goal, app);
  activeTask = { id: taskId, plan, aborted: false, startedAt: Date.now(), currentStep: 0 };

  ctx.bus.publish(CH.AUTO_TASK_START, {
    taskId,
    goal,
    app,
    stepCount: plan.steps.length,
  });

  ctx.bus.publish(CH.UI_TIMELINE_EVENT, {
    type: 'automation',
    title: `Automation: ${goal}`,
    status: 'running',
    taskId,
  });

  ctx.logger.info(`[automation] Starting task ${taskId}: "${goal}" (${plan.steps.length} steps)`);

  // Start input monitoring (skip during demo mode)
  if (process.env.IRIS_DEMO_AUTO !== '1') {
    inputMonitor.start((idleMs) => {
      if (activeTask && !activeTask.aborted) {
        ctx!.logger.warn(`[automation] User activity detected (idle=${idleMs}ms) — aborting task`);
        activeTask.aborted = true;
        ctx!.bus.publish(CH.AUTO_USER_INTERVENED, {
          taskId: activeTask.id,
          idleMs,
          step: activeTask.currentStep,
        });
      }
    });
  }

  const frontApp = app ?? tryGetFrontApp();

  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
    if (activeTask.aborted) {
      ctx.bus.publish(CH.AUTO_TASK_FAILED, {
        taskId,
        goal,
        reason: 'User intervention',
        step: stepIndex,
      });
      tasksFailed++;
      break;
    }

    const step = plan.steps[stepIndex];
    activeTask.currentStep = stepIndex;

    ctx.bus.publish(CH.AUTO_TASK_PROGRESS, {
      taskId,
      step: stepIndex,
      total: plan.steps.length,
      description: step.description,
      checkpoint: step.checkpoint,
    });

    ctx.bus.publish(CH.UI_TIMELINE_EVENT, {
      type: 'automation',
      title: `Step ${stepIndex + 1}/${plan.steps.length}: ${step.description}`,
      status: 'running',
      taskId,
    });

    const backend = routeStep(step, frontApp);
    let stepOk = false;

    for (let attempt = 0; attempt <= step.retries; attempt++) {
      if (activeTask.aborted) break;

      ctx.logger.debug(`[automation] Step ${stepIndex} (attempt ${attempt + 1}): ${step.description} via ${backend}`);
      const result = await executeStep(step, backend);

      if (!result.ok) {
        ctx.logger.warn(`[automation] Step ${stepIndex} failed: ${result.error}`);
        if (attempt < step.retries) {
          await delay(500);
          continue;
        }
        break;
      }

      // Verify step outcome (skip wait steps)
      if (verifier && step.checkpoint !== 'wait') {
        const verification = await verifier.verify(step.expectedOutcome);
        ctx.bus.publish(CH.AUTO_VERIFY_RESULT, {
          taskId,
          step: stepIndex,
          verification,
        });

        if (verification.ok || verification.confidence >= 0.6) {
          stepOk = true;
          break;
        }

        ctx.logger.debug(`[automation] Verification failed (confidence=${verification.confidence}): ${verification.actual}`);
        if (attempt < step.retries) await delay(500);
      } else {
        stepOk = true;
        break;
      }
    }

    if (!stepOk && !activeTask.aborted && step.checkpoint !== 'wait') {
      // Final step failure is always fatal; other steps continue with warning
      if (step.checkpoint === 'final') {
        ctx.logger.error(`[automation] Final verification failed for task ${taskId}`);
        ctx.bus.publish(CH.AUTO_TASK_FAILED, {
          taskId,
          goal,
          reason: `Verification failed at step ${stepIndex}: "${step.expectedOutcome}"`,
          step: stepIndex,
        });
        ctx.bus.publish(CH.UI_TIMELINE_EVENT, {
          type: 'automation',
          title: `Automation failed: ${goal}`,
          status: 'error',
          taskId,
        });
        tasksFailed++;
        activeTask = null;
        inputMonitor.stop();
        return;
      }
      ctx.logger.warn(`[automation] Step ${stepIndex} not verified, continuing`);
    }
  }

  if (activeTask && !activeTask.aborted) {
    const durationMs = Date.now() - activeTask.startedAt;
    ctx.bus.publish(CH.AUTO_TASK_COMPLETE, {
      taskId,
      goal,
      durationMs,
      stepsCompleted: plan.steps.length,
    });
    ctx.bus.publish(CH.UI_TIMELINE_EVENT, {
      type: 'automation',
      title: `Automation complete: ${goal}`,
      status: 'done',
      taskId,
      durationMs,
    });
    ctx.logger.info(`[automation] Task ${taskId} completed in ${durationMs}ms`);
    tasksCompleted++;
  }

  activeTask = null;
  inputMonitor.stop();
};

/**
 * Register all native action tools on the bus via TOOL_REGISTER and TOOL_EXECUTE handler.
 */
const registerTools = () => {
  if (!ctx) return;

  const tools = [
    {
      name: 'click_at',
      description: 'Click at screen coordinates',
      parameters: { x: 'number', y: 'number' },
    },
    {
      name: 'double_click_at',
      description: 'Double-click at screen coordinates',
      parameters: { x: 'number', y: 'number' },
    },
    {
      name: 'type_text',
      description: 'Type text using keyboard',
      parameters: { text: 'string' },
    },
    {
      name: 'press_key',
      description: 'Press a key combination',
      parameters: { modifier: 'string', key: 'string' },
    },
    {
      name: 'scroll',
      description: 'Scroll at position',
      parameters: { x: 'number', y: 'number', deltaY: 'number' },
    },
    {
      name: 'drag',
      description: 'Drag from one position to another',
      parameters: { fromX: 'number', fromY: 'number', toX: 'number', toY: 'number' },
    },
    {
      name: 'open_app',
      description: 'Activate an application by name',
      parameters: { name: 'string' },
    },
    {
      name: 'get_frontmost_app',
      description: 'Get the name of the frontmost application',
      parameters: {},
    },
    {
      name: 'get_window_title',
      description: 'Get the title of the frontmost window',
      parameters: {},
    },
  ];

  for (const tool of tools) {
    ctx.bus.publish(CH.TOOL_REGISTER, {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }

  // Register per-module RPC handler for tool execution
  // mod-tools dispatches to `tools:execute:automation` for our tools
  const handlers: Record<string, (a: Record<string, unknown>) => { ok: boolean; result?: unknown }> = {
    click_at: (a) => { nativeClick(a.x as number, a.y as number); return { ok: true, result: 'clicked' }; },
    double_click_at: (a) => { nativeDoubleClick(a.x as number, a.y as number); return { ok: true, result: 'double-clicked' }; },
    type_text: (a) => { nativeType(a.text as string); return { ok: true, result: `typed: ${(a.text as string).slice(0, 30)}` }; },
    press_key: (a) => { nativeKeyCombo((a.key as string) ?? (a.modifier as string) ?? 'return'); return { ok: true, result: `pressed: ${a.key}` }; },
    scroll: (a) => { nativeScroll(a.x as number ?? 0, a.y as number ?? 0, a.deltaY as number ?? 3); return { ok: true, result: 'scrolled' }; },
    drag: (a) => { nativeDrag(a.fromX as number, a.fromY as number, a.toX as number, a.toY as number); return { ok: true, result: 'dragged' }; },
    open_app: (a) => { activateApp(a.name as string); return { ok: true, result: `opened: ${a.name}` }; },
    get_frontmost_app: () => ({ ok: true, result: getFrontmostApp() }),
    get_window_title: () => ({ ok: true, result: getFrontmostWindowTitle() }),
    run_ui_task: () => ({ ok: false, result: 'Use AUTO_RUN_UI_TASK bus channel instead' }),
  };

  ctx.bus.handle<
    { tool: string; args: Record<string, unknown> },
    { ok: boolean; result?: unknown }
  >('tools:execute:automation', async (payload) => {
    const handler = handlers[payload.tool];
    if (!handler) return { ok: false, result: `Unknown automation tool: ${payload.tool}` };
    try {
      return handler(payload.args);
    } catch (err) {
      return { ok: false, result: err instanceof Error ? err.message : String(err) };
    }
  });
};

export default {
  manifest,

  async start(context: ModuleContext) {
    ctx = context;
    verifier = new VerificationEngine(ctx.bus);

    // Handle run requests
    ctx.bus.subscribe<{ goal: string; app?: string; taskId?: string }>(
      CH.AUTO_RUN_UI_TASK,
      (msg) => {
        runTask(msg.payload.goal, msg.payload.app, msg.payload.taskId).catch((err) => {
          ctx?.logger.error('[automation] Task runner error:', err);
          ctx?.bus.publish(CH.AUTO_TASK_FAILED, {
            goal: msg.payload.goal,
            reason: err instanceof Error ? err.message : String(err),
          });
          tasksFailed++;
          activeTask = null;
          inputMonitor.stop();
        });
      },
    );

    // Handle stop requests
    ctx.bus.subscribe<{ taskId?: string }>(CH.AUTO_STOP_UI_TASK, (msg) => {
      if (activeTask) {
        const requestedId = msg.payload.taskId;
        if (!requestedId || requestedId === activeTask.id) {
          ctx?.logger.info(`[automation] Stop requested for task ${activeTask.id}`);
          activeTask.aborted = true;
        }
      }
    });

    // Register native action tools
    registerTools();

    ctx.logger.info('[mod-automation] Started');
  },

  async stop() {
    inputMonitor.stop();
    if (activeTask) activeTask.aborted = true;
    activeTask = null;
    verifier = null;
    planner.clear();
    ctx = null;
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        activePlans: planner.activePlans,
        hasActiveTask: !!activeTask,
        currentTaskId: activeTask?.id ?? null,
        tasksCompleted,
        tasksFailed,
        inputMonitor: inputMonitor.getState(),
      },
    };
  },
};
