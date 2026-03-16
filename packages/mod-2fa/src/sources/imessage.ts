/**
 * Read 2FA codes from iMessage via AppleScript.
 * Queries recent messages for verification codes.
 */

import { execSync } from 'node:child_process';

export interface IMessageCode {
  code: string;
  sender: string;
  message: string;
  timestamp: string;
}

const CODE_PATTERNS = [
  /(?:code|pin|otp|verification)[\s:]*(\d{4,8})/i,
  /(\d{4,8})\s*(?:is your|est votre|ist Ihr)/i,
  /(?:enter|use|type)\s+(\d{4,8})/i,
  /\b(\d{6})\b/,  // Standalone 6-digit number (common)
];

/**
 * Read recent iMessage messages and extract 2FA codes.
 * Queries the last N minutes of messages.
 */
export const readIMessageCodes = (lookbackMinutes = 5): IMessageCode[] => {
  const codes: IMessageCode[] = [];

  try {
    // Query the iMessage database via AppleScript
    const script = `
      set lookback to ${lookbackMinutes} * 60
      set cutoffDate to (current date) - lookback
      
      tell application "Messages"
        set recentMessages to {}
        repeat with aChat in chats
          try
            repeat with aMsg in (messages of aChat)
              if date received of aMsg > cutoffDate then
                set msgText to text of aMsg
                set senderName to sender of aMsg
                set msgDate to date received of aMsg
                set end of recentMessages to (msgText & "|||" & (senderName as text) & "|||" & (msgDate as text))
              end if
            end repeat
          end try
        end repeat
        
        set AppleScript's text item delimiters to "^^^"
        return recentMessages as text
      end tell
    `;

    const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    if (!raw) return codes;

    const messages = raw.split('^^^');

    for (const msgLine of messages) {
      const parts = msgLine.split('|||');
      if (parts.length < 2) continue;

      const [message, sender, timestamp] = parts;
      if (!message) continue;

      for (const pattern of CODE_PATTERNS) {
        const match = message.match(pattern);
        if (match?.[1]) {
          codes.push({
            code: match[1],
            sender: sender ?? 'unknown',
            message: message.slice(0, 200),
            timestamp: timestamp ?? new Date().toISOString(),
          });
          break; // Only one code per message
        }
      }
    }
  } catch {
    // iMessage access may fail without Accessibility permission
  }

  return codes;
};

/**
 * Shortcut: read just the most recent code.
 */
export const getLatestIMessageCode = (lookbackMinutes = 5): IMessageCode | null => {
  const codes = readIMessageCodes(lookbackMinutes);
  return codes.length > 0 ? codes[codes.length - 1] : null;
};
