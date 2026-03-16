/**
 * Execution policy: routes plan steps to native, browser, or TARS backends.
 */

import type { PlanStep } from './planner';
import { nativeClick, nativeType, nativeDrag, nativeScroll, activateApp, nativeKeyCombo } from './native/actions';

export type ExecutionBackend = 'native' | 'browser' | 'tars';

export interface ExecutionResult {
  ok: boolean;
  backend: ExecutionBackend;
  durationMs: number;
  error?: string;
}

/**
 * Determine which backend to use for a given step.
 */
export const routeStep = (step: PlanStep, frontApp?: string): ExecutionBackend => {
  // Browser-based apps route to browser backend
  const browserApps = ['safari', 'google chrome', 'firefox', 'arc', 'brave browser'];
  if (frontApp && browserApps.some((b) => frontApp.toLowerCase().includes(b))) {
    if (step.action === 'navigate' || step.action === 'focus-search') {
      return 'browser';
    }
  }

  // TARS for complex visual tasks
  if (step.checkpoint === 'final' && step.action === 'verify') {
    return 'tars';
  }

  return 'native';
};

/**
 * Execute a plan step using the determined backend.
 */
export const executeStep = async (
  step: PlanStep,
  backend: ExecutionBackend,
): Promise<ExecutionResult> => {
  const startMs = Date.now();

  try {
    switch (backend) {
      case 'native':
        await executeNative(step);
        break;
      case 'browser':
        await executeBrowser(step);
        break;
      case 'tars':
        // TARS integration is a pass-through — verification handled externally
        break;
    }

    return {
      ok: true,
      backend,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      ok: false,
      backend,
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const executeNative = async (step: PlanStep): Promise<void> => {
  switch (step.action) {
    case 'activate-app':
      if (step.target) activateApp(step.target);
      break;
    case 'click':
      if (step.target) {
        // Parse "x,y" coordinates or use accessibility
        const coords = step.target.match(/^(\d+),\s*(\d+)$/);
        if (coords) {
          nativeClick(parseInt(coords[1]), parseInt(coords[2]));
        }
      }
      break;
    case 'type':
      if (step.value) nativeType(step.value);
      break;
    case 'focus-search':
      // Cmd+F or Cmd+L depending on context
      nativeKeyCombo('command', 'f');
      break;
    case 'navigate':
      // Cmd+L to focus address bar, then type
      nativeKeyCombo('command', 'l');
      await new Promise((r) => setTimeout(r, 300));
      if (step.target) nativeType(step.target);
      nativeKeyCombo('', 'return');
      break;
    case 'wait':
      await new Promise((r) => setTimeout(r, step.timeoutMs));
      break;
    case 'verify':
      // Verification is handled by the VerificationEngine
      break;
  }
};

const executeBrowser = async (step: PlanStep): Promise<void> => {
  // Browser automation uses same native key combos but tailored
  switch (step.action) {
    case 'focus-search':
      nativeKeyCombo('command', 'l');
      break;
    case 'navigate':
      nativeKeyCombo('command', 'l');
      await new Promise((r) => setTimeout(r, 300));
      if (step.target) nativeType(step.target);
      nativeKeyCombo('', 'return');
      break;
    case 'type':
      if (step.value) nativeType(step.value);
      break;
    default:
      await executeNative(step);
  }
};
