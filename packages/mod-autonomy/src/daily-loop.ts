/**
 * Daily loop: hourly tick, once-per-calendar-day Ghost draft generation.
 * Persists state at ~/.iris/daily-loop.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GroqClient } from './groq-client';

interface DailyLoopState {
  lastDraftDate: string; // ISO date string YYYY-MM-DD
  lastTickAt: number;
  draftsGenerated: number;
}

export interface DailyDraft {
  title: string;
  markdown: string;
  date: string;
  generatedAt: number;
}

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export const createDailyLoop = (
  statePath: string,
  groq: GroqClient,
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
) => {
  let state: DailyLoopState = { lastDraftDate: '', lastTickAt: 0, draftsGenerated: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;
  let onDraft: ((draft: DailyDraft) => void) | null = null;

  const loadState = () => {
    try {
      if (existsSync(statePath)) {
        state = JSON.parse(readFileSync(statePath, 'utf-8'));
      }
    } catch {
      state = { lastDraftDate: '', lastTickAt: 0, draftsGenerated: 0 };
    }
  };

  const saveState = () => {
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      logger.warn('Failed to save daily-loop state:', err);
    }
  };

  const todayString = (): string => new Date().toISOString().slice(0, 10);

  const generateDraft = async (): Promise<DailyDraft> => {
    const today = todayString();
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    const prompt = [
      `Write a short daily engineering journal entry for ${dayOfWeek}, ${today}.`,
      'The entry should be reflective and cover typical developer activities:',
      '- What was worked on today',
      '- Key decisions or learnings',
      "- Tomorrow's priorities",
      '',
      'Keep it concise (200-300 words), use markdown format.',
      'Title should be: "Dev Log — <date>"',
    ].join('\n');

    const raw = await groq.complete([
      { role: 'system', content: 'You are a developer writing a daily engineering journal.' },
      { role: 'user', content: prompt },
    ], 0.7);

    // Extract title from first line
    const lines = raw.split('\n').filter((l) => l.trim());
    const title = lines[0]?.replace(/^#+\s*/, '').trim() || `Dev Log — ${today}`;
    const markdown = lines.slice(1).join('\n').trim() || raw;

    return { title, markdown, date: today, generatedAt: Date.now() };
  };

  const tick = async () => {
    const today = todayString();
    state.lastTickAt = Date.now();

    if (state.lastDraftDate === today) {
      return; // Already generated today
    }

    logger.info('Daily loop: generating Ghost draft');

    try {
      const draft = await generateDraft();
      state.lastDraftDate = today;
      state.draftsGenerated++;
      saveState();

      onDraft?.(draft);
      logger.info(`Daily draft generated: "${draft.title}"`);
    } catch (err) {
      logger.error('Daily draft generation failed:', err);
    }
  };

  const start = (draftCallback: (draft: DailyDraft) => void) => {
    onDraft = draftCallback;
    loadState();

    // Initial tick
    tick().catch((err) => logger.error('Initial tick failed:', err));

    // Hourly tick
    timer = setInterval(() => {
      tick().catch((err) => logger.error('Tick failed:', err));
    }, TICK_INTERVAL_MS);

    logger.info('Daily loop started (1h interval)');
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    onDraft = null;
  };

  const getState = () => ({ ...state });

  return { start, stop, tick, getState };
};

export type DailyLoop = ReturnType<typeof createDailyLoop>;
