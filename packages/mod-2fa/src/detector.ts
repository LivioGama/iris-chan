/**
 * 2FA field detection via Accessibility API + Gemini Vision.
 */

import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';
import { execSync } from 'node:child_process';

export interface FieldDetection {
  detected: boolean;
  fieldType: '2fa' | 'otp' | 'sms-code' | 'unknown';
  service?: string;
  confidence: number;
  method: 'accessibility' | 'vision' | 'heuristic';
}

/**
 * Check for focused input field characteristics via Accessibility API.
 */
const checkAccessibility = (): { isFocused: boolean; role?: string; label?: string; placeholderValue?: string } => {
  try {
    const script = `
      tell application "System Events"
        set fp to focused UI element of (first application process whose frontmost is true)
        set r to role of fp
        set d to description of fp
        try
          set v to value of attribute "AXPlaceholderValue" of fp
        on error
          set v to ""
        end try
        return r & "|" & d & "|" & v
      end tell
    `;
    const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();

    const [role, label, placeholderValue] = raw.split('|');
    return {
      isFocused: role === 'AXTextField' || role === 'AXTextArea' || role === 'AXSecureTextField',
      role,
      label,
      placeholderValue,
    };
  } catch {
    return { isFocused: false };
  }
};

/**
 * Detect if a 2FA input field is focused.
 */
export const detectField = async (bus: BusClient): Promise<FieldDetection> => {
  // Step 1: Check accessibility
  const axInfo = checkAccessibility();

  if (!axInfo.isFocused) {
    return { detected: false, fieldType: 'unknown', confidence: 0, method: 'accessibility' };
  }

  // Step 2: Heuristic analysis of field attributes
  const combined = `${axInfo.label ?? ''} ${axInfo.placeholderValue ?? ''}`.toLowerCase();

  const tfaKeywords = ['verification', '2fa', 'two-factor', 'otp', 'one-time', 'security code'];
  const smsKeywords = ['sms', 'text message', 'code we sent', 'enter code', 'digit code'];

  for (const kw of tfaKeywords) {
    if (combined.includes(kw)) {
      return { detected: true, fieldType: '2fa', confidence: 0.9, method: 'heuristic' };
    }
  }

  for (const kw of smsKeywords) {
    if (combined.includes(kw)) {
      return { detected: true, fieldType: 'sms-code', confidence: 0.85, method: 'heuristic' };
    }
  }

  // Step 3: If field is focused but not recognized by heuristics,
  // request vision analysis for higher confidence
  if (axInfo.role === 'AXTextField' || axInfo.role === 'AXSecureTextField') {
    try {
      const captureResult = await bus.request<
        { reason: string },
        { ok: boolean; data?: string; context?: { captureId: string } }
      >(CH.SCREEN_CAPTURE, { reason: '2fa-field-detection' }, 5000);

      if (captureResult.ok && captureResult.data) {
        // Request vision analysis
        const visionPromise = new Promise<FieldDetection>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ detected: false, fieldType: 'unknown', confidence: 0.3, method: 'vision' });
          }, 8000);

          const unsub = bus.subscribe<{ result?: string }>(
            CH.SCREEN_VISION_RESULT,
            (msg) => {
              clearTimeout(timeout);
              unsub();
              try {
                const parsed = JSON.parse(msg.payload.result ?? '{}');
                resolve({
                  detected: parsed.is2fa ?? false,
                  fieldType: parsed.fieldType ?? 'unknown',
                  service: parsed.service,
                  confidence: parsed.confidence ?? 0.5,
                  method: 'vision',
                });
              } catch {
                resolve({ detected: false, fieldType: 'unknown', confidence: 0.3, method: 'vision' });
              }
            },
          );
        });

        bus.publish(CH.SCREEN_VISION_REQUEST, {
          data: captureResult.data,
          prompt: 'Is there a 2FA/OTP/verification code input field visible and focused? Reply JSON: {"is2fa": boolean, "fieldType": "2fa"|"otp"|"sms-code"|"unknown", "service": string|null, "confidence": 0-1}',
          captureId: captureResult.context?.captureId,
        });

        return await visionPromise;
      }
    } catch {
      // Vision not available, fall through
    }
  }

  return { detected: false, fieldType: 'unknown', confidence: 0.2, method: 'accessibility' };
};
