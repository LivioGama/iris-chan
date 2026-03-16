/**
 * ProactiveEngine: analyzes screen context and suggests actions.
 */

import type { WorldContext } from './world-state';

export interface ProactiveSuggestion {
  id: string;
  action: string;
  reason: string;
  confidence: number;
  toolHint?: string;
  timestamp: number;
}

interface Rule {
  match: (ctx: WorldContext) => boolean;
  action: string;
  reason: string;
  toolHint?: string;
  confidence: number;
}

const RULES: Rule[] = [
  {
    match: (ctx) => ctx.frontmostApp.toLowerCase().includes('terminal') && ctx.timeOfDay === 'morning',
    action: 'check-ci',
    reason: 'Morning terminal session — check overnight CI runs',
    toolHint: 'run_command',
    confidence: 0.7,
  },
  {
    match: (ctx) => ctx.frontmostApp.toLowerCase().includes('slack') || ctx.frontmostApp.toLowerCase().includes('discord'),
    action: 'summarize-messages',
    reason: 'Communication app open — offer to summarize unread threads',
    toolHint: 'web_search',
    confidence: 0.6,
  },
  {
    match: (ctx) =>
      (ctx.frontmostApp.toLowerCase().includes('code') || ctx.frontmostApp.toLowerCase().includes('cursor')) &&
      !!ctx.gitBranch,
    action: 'suggest-commit',
    reason: 'Working on a feature branch — consider committing progress',
    toolHint: 'run_command',
    confidence: 0.5,
  },
  {
    match: (ctx) =>
      ctx.frontmostApp.toLowerCase().includes('chrome') || ctx.frontmostApp.toLowerCase().includes('safari') || ctx.frontmostApp.toLowerCase().includes('arc'),
    action: 'capture-link',
    reason: 'Browser session — capture relevant links',
    toolHint: 'recall_link',
    confidence: 0.4,
  },
  {
    match: (ctx) => ctx.timeOfDay === 'evening',
    action: 'daily-review',
    reason: 'Evening — consider wrapping up with a daily review',
    confidence: 0.5,
  },
  {
    match: (ctx) =>
      ctx.windowTitle.toLowerCase().includes('pull request') || ctx.windowTitle.toLowerCase().includes('pr #'),
    action: 'review-pr',
    reason: 'PR page detected — offer code review assistance',
    toolHint: 'run_coding_task',
    confidence: 0.7,
  },
];

let suggestionCounter = 0;
const nextId = (): string => `sug_${Date.now()}_${++suggestionCounter}`;

export const createProactiveEngine = (
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void },
) => {
  const lastSuggested = new Map<string, number>();
  const COOLDOWN_MS = 10 * 60 * 1000; // Don't repeat same suggestion within 10 min

  const analyze = (context: WorldContext): ProactiveSuggestion[] => {
    const now = Date.now();
    const suggestions: ProactiveSuggestion[] = [];

    for (const rule of RULES) {
      if (!rule.match(context)) continue;

      const lastTime = lastSuggested.get(rule.action) ?? 0;
      if (now - lastTime < COOLDOWN_MS) continue;

      suggestions.push({
        id: nextId(),
        action: rule.action,
        reason: rule.reason,
        confidence: rule.confidence,
        toolHint: rule.toolHint,
        timestamp: now,
      });

      lastSuggested.set(rule.action, now);
    }

    if (suggestions.length > 0) {
      logger.info(`Proactive: ${suggestions.length} suggestions for ${context.frontmostApp}`);
    }

    return suggestions;
  };

  return { analyze };
};

export type ProactiveEngine = ReturnType<typeof createProactiveEngine>;
