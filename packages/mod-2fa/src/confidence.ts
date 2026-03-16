/**
 * Confidence scoring for extracted 2FA codes.
 */

export interface ConfidenceResult {
  code: string;
  score: number;
  reasons: string[];
}

/**
 * Score a potential 2FA code based on format and context.
 */
export const scoreCode = (code: string, context?: string): ConfidenceResult => {
  const reasons: string[] = [];
  let score = 0.5; // Base score

  // Length-based scoring
  if (code.length === 6) {
    score += 0.2;
    reasons.push('Standard 6-digit code');
  } else if (code.length === 4) {
    score += 0.1;
    reasons.push('4-digit code');
  } else if (code.length === 8) {
    score += 0.1;
    reasons.push('8-digit code');
  } else {
    score -= 0.2;
    reasons.push(`Unusual length: ${code.length}`);
  }

  // All digits is typical
  if (/^\d+$/.test(code)) {
    score += 0.15;
    reasons.push('Numeric only');
  }

  // Alphanumeric codes (some services use these)
  if (/^[A-Z0-9]+$/i.test(code) && /[A-Z]/i.test(code)) {
    score += 0.05;
    reasons.push('Alphanumeric');
  }

  // Context-based scoring
  if (context) {
    const ctxLower = context.toLowerCase();

    const highConfidenceTerms = ['verification code', '2fa', 'two-factor', 'otp', 'one-time'];
    const medConfidenceTerms = ['code', 'verify', 'authenticate', 'security code', 'login code'];
    const lowConfidenceTerms = ['confirm', 'pin', 'password'];

    for (const term of highConfidenceTerms) {
      if (ctxLower.includes(term)) {
        score += 0.2;
        reasons.push(`High-confidence context: "${term}"`);
        break;
      }
    }

    for (const term of medConfidenceTerms) {
      if (ctxLower.includes(term)) {
        score += 0.1;
        reasons.push(`Medium-confidence context: "${term}"`);
        break;
      }
    }

    // Service-specific patterns
    const services = ['google', 'github', 'apple', 'microsoft', 'aws', 'stripe', 'shopify'];
    for (const svc of services) {
      if (ctxLower.includes(svc)) {
        score += 0.1;
        reasons.push(`Known service: ${svc}`);
        break;
      }
    }
  }

  return {
    code,
    score: Math.min(1, Math.max(0, score)),
    reasons,
  };
};

/**
 * Pick the best code from multiple candidates.
 */
export const pickBestCode = (codes: ConfidenceResult[]): ConfidenceResult | null => {
  if (codes.length === 0) return null;
  return codes.reduce((best, current) =>
    current.score > best.score ? current : best,
  );
};
