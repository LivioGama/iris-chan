/**
 * LearningManager: feedback -> patterns -> skills.
 * Persists learned patterns at ~/.iris/memory.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LearnedPattern {
  id: string;
  trigger: string;
  response: string;
  confidence: number;
  uses: number;
  lastUsed: string;
  createdAt: string;
}

export interface Feedback {
  type: 'positive' | 'negative' | 'correction';
  taskId: string;
  detail: string;
  suggestedFix?: string;
}

interface MemoryStore {
  patterns: LearnedPattern[];
  version: number;
}

export class LearningManager {
  private store: MemoryStore = { patterns: [], version: 1 };
  private filePath: string;
  private logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  constructor(
    filePath: string,
    logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
  ) {
    this.filePath = filePath;
    this.logger = logger;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        this.store = {
          patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
          version: raw.version ?? 1,
        };
      }
    } catch {
      this.store = { patterns: [], version: 1 };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
    } catch (err) {
      this.logger.warn('Failed to save learning memory:', err);
    }
  }

  /**
   * Record feedback and extract a pattern from it.
   */
  addFeedback(feedback: Feedback): LearnedPattern | null {
    if (feedback.type === 'correction' && feedback.suggestedFix) {
      const pattern: LearnedPattern = {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trigger: feedback.detail,
        response: feedback.suggestedFix,
        confidence: 0.6,
        uses: 0,
        lastUsed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      this.store.patterns.push(pattern);
      this.save();
      this.logger.info(`Learned pattern: "${pattern.trigger}" -> "${pattern.response}"`);
      return pattern;
    }

    if (feedback.type === 'positive') {
      // Boost confidence of matching patterns
      for (const p of this.store.patterns) {
        if (feedback.detail.includes(p.trigger)) {
          p.confidence = Math.min(1, p.confidence + 0.1);
          p.uses++;
          p.lastUsed = new Date().toISOString();
        }
      }
      this.save();
    }

    if (feedback.type === 'negative') {
      // Decrease confidence of matching patterns
      for (const p of this.store.patterns) {
        if (feedback.detail.includes(p.trigger)) {
          p.confidence = Math.max(0, p.confidence - 0.15);
        }
      }
      this.save();
    }

    return null;
  }

  /**
   * Find relevant patterns for a given context.
   */
  findPatterns(context: string, minConfidence = 0.4): LearnedPattern[] {
    const contextLower = context.toLowerCase();
    return this.store.patterns
      .filter((p) => p.confidence >= minConfidence && contextLower.includes(p.trigger.toLowerCase()))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Use a pattern — increment counter and confidence.
   */
  usePattern(patternId: string): void {
    const pattern = this.store.patterns.find((p) => p.id === patternId);
    if (pattern) {
      pattern.uses++;
      pattern.lastUsed = new Date().toISOString();
      pattern.confidence = Math.min(1, pattern.confidence + 0.05);
      this.save();
    }
  }

  getStats() {
    return {
      totalPatterns: this.store.patterns.length,
      avgConfidence: this.store.patterns.length > 0
        ? this.store.patterns.reduce((s, p) => s + p.confidence, 0) / this.store.patterns.length
        : 0,
    };
  }
}
