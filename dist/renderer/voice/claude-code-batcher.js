"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClaudeCodeBatcher = createClaudeCodeBatcher;
const logger_js_1 = require("../logger.js");
// Patterns that indicate task completion in terminal/log output
const COMPLETION_PATTERNS = [
    /✅\s*(COMPLETED|Completed|Done|SUCCESS)/i,
    /❌\s*(FAILED|Error|Failed)/i,
    /^Build succeeded/im,
    /^Compiled successfully/im,
    /^All \d+ tests? passed/im,
    /^Tests?:\s+\d+ passed/im,
    /^\$\s*$/m, // bare shell prompt reappearance
    /^Done in \d+/im,
    /^Successfully compiled/im,
    /npm warn|npm ERR!/i, // npm completion (success or error)
    /\[result\]\s*(success|error|fail)/i,
];
// Patterns that indicate an error/failure (must not match "0 failed" in test summaries)
const FAILURE_PATTERNS = [
    /❌/,
    /(?<!\d\s)FAILED(?!\s*:?\s*0)/i, // "FAILED" but not "0 failed" or "failed: 0"
    /^Error:/im,
    /npm ERR!/,
    /Build failed/i,
    /Compilation failed/i,
    /FATAL/i,
    /Unhandled.*exception/i,
];
const HEARTBEAT_TIMEOUT_MS = 120_000; // 2 minutes with no log activity → stale
const SCREENSHOT_POLL_MS = 15_000; // capture screenshot every 15s during active tasks
const STALE_PURGE_MS = 300_000; // 5 minutes
function createClaudeCodeBatcher({ gemini, screen }) {
    const entries = new Map();
    let cleanupInterval = null;
    let screenshotInterval = null;
    /** Track a new log line for a task */
    const addLine = (taskId, line) => {
        const now = Date.now();
        if (!entries.has(taskId)) {
            entries.set(taskId, {
                lines: [],
                lastActivity: now,
                createdAt: now,
                completionDetected: false,
                notifiedGemini: false,
            });
            (0, logger_js_1.info)('Batcher', `Tracking new task: ${taskId}`);
            // Start screenshot monitoring if not already running
            _ensureScreenshotPoll();
        }
        const entry = entries.get(taskId);
        entry.lines.push(line);
        entry.lastActivity = now;
        if (entry.lines.length > 150)
            entry.lines = entry.lines.slice(-80);
        // Check for completion patterns in the new line
        _checkCompletionPattern(taskId, entry, line);
    };
    /** Check if a log line matches known completion patterns */
    const _checkCompletionPattern = (taskId, entry, line) => {
        if (entry.completionDetected)
            return;
        for (const pattern of COMPLETION_PATTERNS) {
            if (pattern.test(line)) {
                entry.completionDetected = true;
                const isFailure = FAILURE_PATTERNS.some(p => p.test(line));
                (0, logger_js_1.info)('Batcher', `Completion pattern detected for ${taskId}: "${line.slice(0, 100)}" (${isFailure ? 'failure' : 'success'})`);
                // Don't notify Gemini here — wait for the authoritative 'done' IPC event.
                // But log it so the watchdog knows this task is wrapping up.
                break;
            }
        }
    };
    /** Handle authoritative task completion from main process */
    const handleDone = (taskId, status, summary) => {
        const entry = entries.get(taskId);
        entries.delete(taskId);
        _maybeStopScreenshotPoll();
        (0, logger_js_1.info)('Batcher', `Task done: ${taskId} → ${status}`);
        if (screen) {
            setTimeout(() => {
                screen.capture(false).catch(() => { });
            }, 2000);
        }
    };
    /** Watchdog: detect stale tasks that stopped producing output */
    const _checkWatchdog = () => {
        const now = Date.now();
        for (const [taskId, entry] of entries) {
            // Purge very old stale entries
            if (now - (entry.createdAt || 0) > STALE_PURGE_MS && entry.lines.length === 0) {
                entries.delete(taskId);
                (0, logger_js_1.info)('Batcher', `Purged stale entry: ${taskId}`);
                continue;
            }
            // Heartbeat watchdog: no activity for too long
            if (!entry.completionDetected && now - entry.lastActivity > HEARTBEAT_TIMEOUT_MS) {
                (0, logger_js_1.info)('Batcher', `Heartbeat timeout for ${taskId} — no activity for ${Math.round((now - entry.lastActivity) / 1000)}s`);
                entry.completionDetected = true; // prevent re-notification
                entry.notifiedGemini = true;
                // Capture a screenshot for visual verification of stale state
                if (screen) {
                    screen.capture(false).catch(() => { });
                }
            }
        }
        _maybeStopScreenshotPoll();
    };
    /** Periodic screenshot capture during active task execution */
    const _screenshotPoll = () => {
        if (entries.size === 0)
            return;
        if (!screen)
            return;
        screen.capture(true).catch(() => { });
        (0, logger_js_1.info)('Batcher', `Screenshot poll — ${entries.size} active task(s)`);
    };
    const _ensureScreenshotPoll = () => {
        if (screenshotInterval)
            return;
        screenshotInterval = setInterval(_screenshotPoll, SCREENSHOT_POLL_MS);
        (0, logger_js_1.info)('Batcher', 'Screenshot monitoring started');
    };
    const _maybeStopScreenshotPoll = () => {
        if (entries.size === 0 && screenshotInterval) {
            clearInterval(screenshotInterval);
            screenshotInterval = null;
            (0, logger_js_1.info)('Batcher', 'Screenshot monitoring stopped (no active tasks)');
        }
    };
    const getActiveTaskIds = () => [...entries.keys()];
    const hasActiveTasks = () => entries.size > 0;
    const start = () => {
        stop();
        cleanupInterval = setInterval(_checkWatchdog, 30000);
    };
    const stop = () => {
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
        if (screenshotInterval) {
            clearInterval(screenshotInterval);
            screenshotInterval = null;
        }
        entries.clear();
    };
    return { addLine, handleDone, start, stop, getActiveTaskIds, hasActiveTasks };
}
