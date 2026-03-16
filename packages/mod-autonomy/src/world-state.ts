import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';

export interface WorldContext {
  frontmostApp: string;
  windowTitle: string;
  timeOfDay: string;
  gitBranch: string | undefined;
  workspace: string | undefined;
}

const getTimeOfDay = (): string => {
  const h = new Date().getHours();
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
};

export const createWorldState = (
  bus: BusClient,
  logger: { debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
) => {
  let currentApp = 'unknown';
  let currentTitle = '';
  let currentBranch: string | undefined;
  let currentWorkspace: string | undefined;

  // Listen for screen capture events that may carry frontmost app info
  bus.subscribe<{ frontmostApp?: string; windowTitle?: string }>(
    CH.SCREEN_CAPTURE_READY,
    (msg) => {
      if (msg.payload.frontmostApp) currentApp = msg.payload.frontmostApp;
      if (msg.payload.windowTitle) currentTitle = msg.payload.windowTitle;
    },
  );

  const getContext = async (): Promise<WorldContext> => {
    // Try to get frontmost app info from tools module
    try {
      const result = await bus.request<{ tool: string; args: Record<string, unknown> }, { frontmostApp?: string; windowTitle?: string; gitBranch?: string; workspace?: string }>(
        CH.TOOL_EXECUTE,
        { tool: 'get-frontmost-app', args: {} },
        3000,
      );
      if (result.frontmostApp) currentApp = result.frontmostApp;
      if (result.windowTitle) currentTitle = result.windowTitle;
      if (result.gitBranch) currentBranch = result.gitBranch;
      if (result.workspace) currentWorkspace = result.workspace;
    } catch {
      logger.debug('Could not fetch frontmost app from tools, using cached values');
    }

    return {
      frontmostApp: currentApp,
      windowTitle: currentTitle,
      timeOfDay: getTimeOfDay(),
      gitBranch: currentBranch,
      workspace: currentWorkspace,
    };
  };

  const update = (partial: Partial<WorldContext>) => {
    if (partial.frontmostApp) currentApp = partial.frontmostApp;
    if (partial.windowTitle) currentTitle = partial.windowTitle;
    if (partial.gitBranch !== undefined) currentBranch = partial.gitBranch;
    if (partial.workspace !== undefined) currentWorkspace = partial.workspace;
  };

  return { getContext, update };
};

export type WorldState = ReturnType<typeof createWorldState>;
