/**
 * Native desktop actions via AppleScript and CGEvent (child_process.execSync).
 */

import { execSync } from 'node:child_process';

const osascript = (script: string): string => {
  try {
    return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch (err) {
    throw new Error(`AppleScript failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Click at absolute screen coordinates using CGEvent via cliclick.
 * Falls back to AppleScript mouse events.
 */
export const nativeClick = (x: number, y: number): void => {
  try {
    execSync(`cliclick c:${x},${y}`, { timeout: 3000 });
  } catch {
    // Fallback to AppleScript
    osascript(`
      tell application "System Events"
        click at {${x}, ${y}}
      end tell
    `);
  }
};

/**
 * Double click at coordinates.
 */
export const nativeDoubleClick = (x: number, y: number): void => {
  try {
    execSync(`cliclick dc:${x},${y}`, { timeout: 3000 });
  } catch {
    osascript(`
      tell application "System Events"
        click at {${x}, ${y}}
        delay 0.05
        click at {${x}, ${y}}
      end tell
    `);
  }
};

/**
 * Type text using AppleScript keystroke.
 */
export const nativeType = (text: string): void => {
  // Escape special chars for AppleScript
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  osascript(`
    tell application "System Events"
      keystroke "${escaped}"
    end tell
  `);
};

/**
 * Drag from one point to another.
 */
export const nativeDrag = (fromX: number, fromY: number, toX: number, toY: number): void => {
  try {
    execSync(`cliclick dd:${fromX},${fromY} du:${toX},${toY}`, { timeout: 5000 });
  } catch {
    osascript(`
      tell application "System Events"
        -- Mouse down at start
        click at {${fromX}, ${fromY}}
        delay 0.3
        -- Mouse move+up at end
        click at {${toX}, ${toY}}
      end tell
    `);
  }
};

/**
 * Scroll by delta amount. Positive = down, negative = up.
 */
export const nativeScroll = (_x: number, _y: number, deltaY: number): void => {
  try {
    // Use Python to send scroll events via Quartz
    const clicks = Math.abs(Math.round(deltaY));
    const direction = deltaY > 0 ? -3 : 3; // negative = down in Quartz
    execSync(
      `python3 -c "import Quartz; [Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, ${direction})) for _ in range(${clicks})]"`,
      { timeout: 3000 },
    );
  } catch {
    // Ignore scroll failures
  }
};

/**
 * Press a key combination (modifier + key).
 */
/**
 * Press a key or key combo. Accepts formats:
 * - "return", "escape", "tab" (single key)
 * - "cmd+c", "cmd+shift+s" (combo with modifiers)
 * - modifier and key as separate params (legacy)
 */
export const nativeKeyCombo = (modifierOrCombo: string, key?: string): void => {
  // Parse combo format: "cmd+shift+s" or "return"
  let modifiers: string[] = [];
  let actualKey: string;

  if (key && key !== '') {
    modifiers = modifierOrCombo ? [modifierOrCombo] : [];
    actualKey = key;
  } else {
    const parts = modifierOrCombo.split('+').map((p) => p.trim().toLowerCase());
    actualKey = parts.pop()!;
    modifiers = parts;
  }

  const modMap: Record<string, string> = {
    command: 'command down', cmd: 'command down',
    shift: 'shift down',
    option: 'option down', alt: 'option down',
    control: 'control down', ctrl: 'control down',
  };

  // Special keys that need key code instead of keystroke
  const specialKey = getKeyCode(actualKey);
  const isSpecial = ['return', 'enter', 'tab', 'space', 'delete', 'escape',
    'up', 'down', 'left', 'right', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6']
    .includes(actualKey.toLowerCase());

  if (modifiers.length === 0 && isSpecial) {
    osascript(`tell application "System Events" to key code ${specialKey}`);
    return;
  }

  const usingClause = modifiers.length > 0
    ? ` using {${modifiers.map((m) => modMap[m] ?? 'command down').join(', ')}}`
    : '';

  if (isSpecial) {
    osascript(`tell application "System Events" to key code ${specialKey}${usingClause}`);
  } else {
    osascript(`tell application "System Events" to keystroke "${actualKey}"${usingClause}`);
  }
};

/**
 * Activate (bring to front) an application by name.
 */
export const activateApp = (appName: string): void => {
  osascript(`tell application "${appName}" to activate`);
};

/**
 * Get the frontmost application name.
 */
export const getFrontmostApp = (): string => {
  return osascript(`
    tell application "System Events"
      name of first application process whose frontmost is true
    end tell
  `);
};

/**
 * Get the title of the frontmost window.
 */
export const getFrontmostWindowTitle = (): string => {
  try {
    return osascript(`
      tell application "System Events"
        tell (first application process whose frontmost is true)
          name of front window
        end tell
      end tell
    `);
  } catch {
    return '';
  }
};

const getKeyCode = (key: string): number => {
  const codes: Record<string, number> = {
    return: 36,
    enter: 76,
    tab: 48,
    space: 49,
    delete: 51,
    escape: 53,
    up: 126,
    down: 125,
    left: 123,
    right: 124,
    f1: 122,
    f2: 120,
    f3: 99,
    f4: 118,
    f5: 96,
    f6: 97,
  };
  return codes[key.toLowerCase()] ?? 36;
};
