/**
 * Auto-fill logic: pastes 2FA codes into the focused field.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import { execSync } from 'node:child_process';

export interface FillResult {
  ok: boolean;
  code: string;
  method: 'paste' | 'keystroke';
  error?: string;
}

/**
 * Fill a 2FA code into the currently focused field.
 * Tries clipboard paste first, falls back to keystroke.
 */
export const fillCode = async (code: string, bus: BusClient): Promise<FillResult> => {
  // Save current clipboard
  let previousClipboard = '';
  try {
    previousClipboard = execSync('pbpaste', { encoding: 'utf-8', timeout: 2000 });
  } catch {
    // Ignore
  }

  try {
    // Method 1: Copy to clipboard and paste
    execSync(`echo -n "${code}" | pbcopy`, { timeout: 2000, shell: '/bin/bash' });

    // Small delay to ensure clipboard is set
    await new Promise((r) => setTimeout(r, 100));

    // Paste via Cmd+V
    execSync(
      `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
      { timeout: 3000 },
    );

    // Restore previous clipboard after a short delay
    setTimeout(() => {
      try {
        if (previousClipboard) {
          execSync(`echo -n "${previousClipboard.replace(/"/g, '\\"')}" | pbcopy`, {
            timeout: 2000,
            shell: '/bin/bash',
          });
        }
      } catch {
        // Ignore clipboard restore errors
      }
    }, 1000);

    return { ok: true, code, method: 'paste' };
  } catch (pasteErr) {
    // Method 2: Type via keystroke
    try {
      const escaped = code.replace(/"/g, '\\"');
      execSync(
        `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
        { timeout: 3000 },
      );

      return { ok: true, code, method: 'keystroke' };
    } catch (typeErr) {
      return {
        ok: false,
        code,
        method: 'keystroke',
        error: typeErr instanceof Error ? typeErr.message : String(typeErr),
      };
    }
  }
};
