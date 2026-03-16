/**
 * Monitor macOS notifications for 2FA codes.
 * Uses AppleScript to read Notification Center.
 */

import { execSync } from 'node:child_process';

export interface NotificationCode {
  code: string;
  appName: string;
  title: string;
  body: string;
  detectedAt: number;
}

const CODE_PATTERNS = [
  /(?:code|pin|otp|verification)[\s:]*(\d{4,8})/i,
  /(\d{4,8})\s*(?:is your|est votre)/i,
  /(?:enter|use)\s+(\d{4,8})/i,
  /\b(\d{6})\b/, // Standalone 6-digit
];

/**
 * Read recent notifications via AppleScript.
 * Note: requires macOS Accessibility permission.
 */
export const readNotifications = (): NotificationCode[] => {
  const codes: NotificationCode[] = [];

  try {
    const script = `
      tell application "System Events"
        tell process "NotificationCenter"
          set notifTexts to {}
          try
            set notifWindows to windows
            repeat with w in notifWindows
              try
                set allText to ""
                repeat with el in (UI elements of w)
                  try
                    set elVal to value of el as text
                    set allText to allText & " " & elVal
                  end try
                  try
                    repeat with subEl in (UI elements of el)
                      try
                        set subVal to value of subEl as text
                        set allText to allText & " " & subVal
                      end try
                    end repeat
                  end try
                end repeat
                if allText is not "" then
                  set end of notifTexts to allText
                end if
              end try
            end repeat
          end try
          
          set AppleScript's text item delimiters to "|||"
          return notifTexts as text
        end tell
      end tell
    `;

    const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!raw) return codes;

    const notifications = raw.split('|||');

    for (const notif of notifications) {
      const text = notif.trim();
      if (!text) continue;

      for (const pattern of CODE_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) {
          codes.push({
            code: match[1],
            appName: 'NotificationCenter',
            title: text.slice(0, 50),
            body: text.slice(0, 200),
            detectedAt: Date.now(),
          });
          break;
        }
      }
    }
  } catch {
    // Notification reading requires Accessibility permission
  }

  return codes;
};
