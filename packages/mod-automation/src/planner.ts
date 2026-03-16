/**
 * PlanningEngine: decomposes a high-level goal into executable steps.
 * Each step has a checkpoint type and expected outcome.
 */

export type CheckpointType = 'app-switch' | 'navigation' | 'search' | 'input' | 'click' | 'wait' | 'final';

export interface PlanStep {
  id: number;
  checkpoint: CheckpointType;
  description: string;
  action: string;
  target?: string;
  value?: string;
  expectedOutcome: string;
  timeoutMs: number;
  retries: number;
}

export interface Plan {
  goal: string;
  app?: string;
  steps: PlanStep[];
  createdAt: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 2;

/**
 * Decompose a goal string into plan steps.
 * Uses heuristic keyword matching to build a reasonable plan.
 */
export const decompose = (goal: string, app?: string): Plan => {
  const steps: PlanStep[] = [];
  let stepId = 0;

  const addStep = (
    checkpoint: CheckpointType,
    description: string,
    action: string,
    opts: Partial<Pick<PlanStep, 'target' | 'value' | 'expectedOutcome' | 'timeoutMs' | 'retries'>> = {},
  ) => {
    steps.push({
      id: stepId++,
      checkpoint,
      description,
      action,
      target: opts.target,
      value: opts.value,
      expectedOutcome: opts.expectedOutcome ?? description,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: opts.retries ?? DEFAULT_RETRIES,
    });
  };

  // Step 1: If app specified, switch to it
  if (app) {
    addStep('app-switch', `Activate ${app}`, 'activate-app', {
      target: app,
      expectedOutcome: `${app} is frontmost`,
    });
  }

  const goalLower = goal.toLowerCase();

  // Detect search-style goals
  if (goalLower.includes('search') || goalLower.includes('find') || goalLower.includes('look up')) {
    const searchTerm = goal.replace(/^(search|find|look up)\s+(for\s+)?/i, '').trim();
    addStep('navigation', 'Navigate to search field', 'focus-search', {
      expectedOutcome: 'Search field is focused',
    });
    addStep('search', `Type search query: ${searchTerm}`, 'type', {
      value: searchTerm,
      expectedOutcome: 'Search results visible',
    });
    addStep('wait', 'Wait for results', 'wait', {
      timeoutMs: 3000,
      expectedOutcome: 'Results loaded',
    });
  }

  // Detect navigation goals
  if (goalLower.includes('open') || goalLower.includes('go to') || goalLower.includes('navigate')) {
    const target = goal.replace(/^(open|go to|navigate to)\s+/i, '').trim();
    addStep('navigation', `Navigate to ${target}`, 'navigate', {
      target,
      expectedOutcome: `${target} is visible`,
    });
  }

  // Detect typing goals
  if (goalLower.includes('type') || goalLower.includes('enter') || goalLower.includes('write')) {
    const text = goal.replace(/^(type|enter|write)\s+/i, '').trim();
    addStep('input', `Type: ${text}`, 'type', {
      value: text,
      expectedOutcome: 'Text entered',
    });
  }

  // Detect click goals
  if (goalLower.includes('click') || goalLower.includes('press') || goalLower.includes('tap')) {
    const target = goal.replace(/^(click|press|tap)\s+(on\s+)?/i, '').trim();
    addStep('click', `Click ${target}`, 'click', {
      target,
      expectedOutcome: `${target} clicked`,
    });
  }

  // Final verification step
  addStep('final', 'Verify task completion', 'verify', {
    expectedOutcome: goal,
    timeoutMs: 8000,
  });

  return { goal, app, steps, createdAt: Date.now() };
};

export class PlanningEngine {
  private plans: Map<string, Plan> = new Map();

  createPlan(goal: string, app?: string): Plan {
    const plan = decompose(goal, app);
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.plans.set(planId, plan);
    return plan;
  }

  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  get activePlans(): number {
    return this.plans.size;
  }

  clear(): void {
    this.plans.clear();
  }
}
