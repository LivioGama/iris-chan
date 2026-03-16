/**
 * SelfImprovementManager: learns from coding task outcomes
 * and adjusts prompts and strategies.
 */

export interface TaskOutcome {
  taskId: string;
  prompt: string;
  success: boolean;
  durationMs: number;
  output: string[];
  error?: string;
}

export interface ImprovementSuggestion {
  type: 'prompt-refinement' | 'strategy-change' | 'tool-preference';
  description: string;
  confidence: number;
}

export class SelfImprovementManager {
  private outcomes: TaskOutcome[] = [];
  private maxHistory = 100;

  recordOutcome(outcome: TaskOutcome): ImprovementSuggestion[] {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.maxHistory) {
      this.outcomes = this.outcomes.slice(-this.maxHistory);
    }
    return this.analyze(outcome);
  }

  private analyze(latest: TaskOutcome): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // Check for repeated failures with similar prompts
    const recentFailures = this.outcomes
      .filter((o) => !o.success)
      .slice(-10);

    if (recentFailures.length >= 3) {
      const errorPatterns = this.findErrorPatterns(recentFailures);
      for (const pattern of errorPatterns) {
        suggestions.push({
          type: 'prompt-refinement',
          description: `Repeated failure pattern: "${pattern}" — consider adding explicit constraints`,
          confidence: 0.7,
        });
      }
    }

    // Check if tasks are taking too long
    const avgDuration = this.outcomes.reduce((sum, o) => sum + o.durationMs, 0) / this.outcomes.length;
    if (latest.durationMs > avgDuration * 2 && latest.success) {
      suggestions.push({
        type: 'strategy-change',
        description: `Task took ${(latest.durationMs / 1000).toFixed(0)}s (2x average) — consider splitting into subtasks`,
        confidence: 0.5,
      });
    }

    // Track success rate
    const successRate = this.outcomes.filter((o) => o.success).length / this.outcomes.length;
    if (successRate < 0.5 && this.outcomes.length >= 5) {
      suggestions.push({
        type: 'strategy-change',
        description: `Success rate is ${(successRate * 100).toFixed(0)}% — review task decomposition`,
        confidence: 0.8,
      });
    }

    return suggestions;
  }

  private findErrorPatterns(failures: TaskOutcome[]): string[] {
    const patterns: string[] = [];
    const errorCounts = new Map<string, number>();

    for (const f of failures) {
      const error = f.error ?? f.output.find((l) => l.includes('error') || l.includes('Error')) ?? '';
      // Extract error class/type
      const match = error.match(/(\w+Error|ENOENT|EACCES|timeout|permission)/i);
      if (match) {
        const key = match[1].toLowerCase();
        errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [pattern, count] of errorCounts) {
      if (count >= 2) patterns.push(pattern);
    }

    return patterns;
  }

  getStats() {
    const total = this.outcomes.length;
    const successes = this.outcomes.filter((o) => o.success).length;
    const avgDuration = total > 0
      ? this.outcomes.reduce((s, o) => s + o.durationMs, 0) / total
      : 0;

    return {
      totalTasks: total,
      successRate: total > 0 ? successes / total : 0,
      avgDurationMs: avgDuration,
    };
  }
}
