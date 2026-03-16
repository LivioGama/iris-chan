/**
 * Task enricher: AI-powered enrichment of task prompts
 * before they are executed.
 */

export interface EnrichedPrompt {
  original: string;
  enriched: string;
  additions: string[];
}

/**
 * Enrich a task prompt with contextual information.
 * Adds project conventions, file patterns, and quality guidelines.
 */
export const enrichPrompt = (
  prompt: string,
  context?: {
    projectRoot?: string;
    gitBranch?: string;
    recentFiles?: string[];
    conventions?: string[];
  },
): EnrichedPrompt => {
  const additions: string[] = [];
  const parts = [prompt];

  // Add project context
  if (context?.projectRoot) {
    additions.push(`Working directory: ${context.projectRoot}`);
  }

  if (context?.gitBranch) {
    additions.push(`Current branch: ${context.gitBranch}`);
  }

  // Add recent file context for relevance
  if (context?.recentFiles && context.recentFiles.length > 0) {
    additions.push(`Recently modified files:\n${context.recentFiles.slice(0, 10).map((f) => `  - ${f}`).join('\n')}`);
  }

  // Add coding conventions
  if (context?.conventions && context.conventions.length > 0) {
    additions.push(`Project conventions:\n${context.conventions.map((c) => `  - ${c}`).join('\n')}`);
  }

  // Standard quality guidelines
  additions.push(
    'Quality guidelines:',
    '  - Write tests for new functionality',
    '  - Follow existing code patterns and naming conventions',
    '  - Handle errors gracefully',
    '  - Keep changes minimal and focused',
  );

  if (additions.length > 0) {
    parts.push('\n--- Context ---');
    parts.push(additions.join('\n'));
  }

  return {
    original: prompt,
    enriched: parts.join('\n'),
    additions,
  };
};
