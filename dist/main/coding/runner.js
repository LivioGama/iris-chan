"use strict";
const log = require('../logger');
const { emitCodingStream } = require('./stream');
const { createCodingAdapter, resolveCodingProviderName } = require('./providers');
function startCodingTask({ taskId, prompt, cwd, env = process.env, onLog, onDone, adapterFactory = createCodingAdapter } = {}) {
    const providerName = resolveCodingProviderName(env);
    const adapter = adapterFactory({ env });
    const controller = new AbortController();
    let logBuffer = '';
    let heartbeatTimer = null;
    let lastMessageTime = Date.now();
    let completed = false;
    const appendLog = (line) => {
        if (!line)
            return;
        logBuffer += (logBuffer ? '\n' : '') + line;
        lastMessageTime = Date.now();
        onLog?.(line, logBuffer);
        emitCodingStream('log', { taskId, line });
    };
    const completion = (async () => {
        heartbeatTimer = setInterval(() => {
            const elapsed = Math.round((Date.now() - lastMessageTime) / 1000);
            emitCodingStream('log', { taskId, line: `[heartbeat] alive — ${elapsed}s since last SDK message` });
        }, 30000);
        try {
            log.info('CodingRunner', `Starting ${providerName} provider for ${taskId} in ${cwd}`);
            const result = await adapter.run({
                prompt,
                cwd,
                env,
                signal: controller.signal,
                onLog: appendLog,
            });
            const status = result?.status || 'COMPLETED';
            const summary = result?.summary || logBuffer.slice(-500);
            const completionLine = `${status === 'COMPLETED' ? '✅' : '❌'} ${status}: ${summary || 'No details'}`;
            if (completionLine.trim())
                appendLog(completionLine);
            completed = true;
            onDone?.({ status, summary, logBuffer, provider: providerName });
            emitCodingStream('done', { taskId, status, summary });
            return { ok: status === 'COMPLETED', status, summary, logBuffer, provider: providerName };
        }
        catch (err) {
            const message = err?.message || 'Unknown error';
            log.error('CodingRunner', `Execution error: ${err?.stack || message}`);
            appendLog(`❌ Error: ${message}`);
            completed = true;
            onDone?.({ status: 'FAILED', summary: `Error: ${message}`, logBuffer, provider: providerName });
            emitCodingStream('done', { taskId, status: 'FAILED', summary: `Error: ${message}` });
            return { ok: false, status: 'FAILED', summary: `Error: ${message}`, logBuffer, provider: providerName };
        }
        finally {
            clearInterval(heartbeatTimer);
        }
    })();
    return {
        provider: providerName,
        cancel(reason = `Cancelled ${taskId}`) {
            if (!controller.signal.aborted)
                controller.abort(new Error(reason));
        },
        getLogBuffer() {
            return logBuffer;
        },
        get completed() {
            return completed;
        },
        completion,
    };
}
module.exports = { startCodingTask };
