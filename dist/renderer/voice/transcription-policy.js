"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDLE_NOISE_PATTERN = void 0;
exports.cleanTranscript = cleanTranscript;
exports.shouldDropTranscript = shouldDropTranscript;
const FRENCH_ENGLISH_REMAP = {
    'ze': 'the',
    'zis': 'this',
    'wiz': 'with',
    'tou': 'to',
    'de': 'the',
};
// Common French phrases the user mixes into English conversation
// These are kept as-is (not translated) so Gemini can interpret them in context
const FRENCH_PHRASE_NORMALIZATIONS = {
    'ah ton je vay tuh shahn zhay': 'attends je vais te changer',
    'ah ton juh vay tuh shahn zhay': 'attends je vais te changer',
    'a ton je ve te shon jay': 'attends je vais te changer',
    'a ton juh veh tuh modify yay': 'attends je vais te modifier',
    'juh veh tuh modify yay': 'je vais te modifier',
    'juh vay tuh shahn zhay': 'je vais te changer',
};
const MULTILINGUAL_PHRASE_NORMALIZATIONS = {
    'डू यू सी माय स्क्रीन': 'do you see my screen',
    'एनसी में एक रेंट स्क्रीन': 'can you see my current screen',
    'change your voice to bloom but warm': 'switch to bloom voice preset and make it warmer',
    'change your voice to bloom and warm': 'switch to bloom voice preset and make it warmer',
    'चेंज योर वॉइस टू ब्लूम बट वार्म': 'switch to bloom voice preset and make it warmer',
    'चेंज योर वॉइस टू ब्लूम एंड वार्म': 'switch to bloom voice preset and make it warmer',
    'चेंज योर वॉयस टू ब्लूम बट वार्म': 'switch to bloom voice preset and make it warmer',
    'चेंज योर वॉयस टू ब्लूम एंड वार्म': 'switch to bloom voice preset and make it warmer',
};
const FILLER_PATTERNS = [
    /^\s*(uh+|um+|hmm+|mm+)\s*$/i,
    /^\s*(thanks|thank you|okay|ok)\s*$/i,
];
const INTERNAL_TRANSCRIPT_PATTERNS = [
    /^\s*\[(?:CLAUDE CODE|SCREENSHOT|SYSTEM:)/i,
    /^\s*\[[^\]]*progress update:/i,
];
function cleanTranscript(text, corrections = {}, hints = {}) {
    if (!text)
        return '';
    let out = String(text);
    if (hints?.language === 'fr-en') {
        out = out.replace(/\bconnexion\b/gi, 'connection');
        out = out.replace(/\bvérification\b/gi, 'verification');
        out = out.replace(/\bmot de passe\b/gi, 'password');
    }
    for (const [wrong, right] of Object.entries(corrections || {})) {
        const re = new RegExp(`\\b${escapeRegExp(wrong)}\\b`, 'gi');
        out = out.replace(re, right);
    }
    // Normalize French phrase fragments before word-level remapping
    for (const [wrong, right] of Object.entries(FRENCH_PHRASE_NORMALIZATIONS)) {
        const re = new RegExp(escapeRegExp(wrong), 'gi');
        out = out.replace(re, right);
    }
    for (const [wrong, right] of Object.entries(MULTILINGUAL_PHRASE_NORMALIZATIONS)) {
        const re = new RegExp(escapeRegExp(wrong), 'gi');
        out = out.replace(re, right);
    }
    for (const [wrong, right] of Object.entries(FRENCH_ENGLISH_REMAP)) {
        const re = new RegExp(`\\b${wrong}\\b`, 'gi');
        out = out.replace(re, right);
    }
    out = out.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();
    if (FILLER_PATTERNS.some((re) => re.test(out)))
        return '';
    return out;
}
exports.IDLE_NOISE_PATTERN = /(i'?m here|i'?m listening|silence is correct behavior|go ahead i'?m ready|standing by|waiting for your instructions)/i;
function shouldDropTranscript(text) {
    if (!text)
        return true;
    if (text.length <= 1)
        return true;
    if (INTERNAL_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text)))
        return true;
    return exports.IDLE_NOISE_PATTERN.test(text);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
