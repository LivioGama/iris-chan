"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceMonitor = void 0;
exports.createPerformanceMonitor = createPerformanceMonitor;
const logger_js_1 = require("./logger.js");
const HISTORY_LIMIT = 10;
const RENDER_SAMPLE_WINDOW = 30;
const RESOURCE_SAMPLE_INTERVAL_MS = 15000;
const IPC_SAMPLE_INTERVAL_MS = 20000;
function clone(value) {
    if (typeof structuredClone === 'function')
        return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}
function round(value, digits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    const factor = 10 ** digits;
    return Math.round(numeric * factor) / factor;
}
function pushHistory(bucket, sample) {
    bucket.current = sample;
    bucket.history.push(sample);
    if (bucket.history.length > HISTORY_LIMIT) {
        bucket.history.splice(0, bucket.history.length - HISTORY_LIMIT);
    }
}
function toMiB(bytes) {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric))
        return null;
    return round(numeric / (1024 * 1024), 2);
}
function pickRendererHeap(perfMemory) {
    if (!perfMemory || typeof perfMemory !== 'object')
        return null;
    return {
        jsHeapUsedMiB: toMiB(perfMemory.usedJSHeapSize),
        jsHeapTotalMiB: toMiB(perfMemory.totalJSHeapSize),
        jsHeapLimitMiB: toMiB(perfMemory.jsHeapSizeLimit),
    };
}
class PerformanceMonitor {
    constructor({ getResourceMetrics = null, pingIpc = null } = {}) {
        this._startedAt = Date.now();
        this._getResourceMetrics = typeof getResourceMetrics === 'function' ? getResourceMetrics : null;
        this._pingIpc = typeof pingIpc === 'function' ? pingIpc : null;
        this._resourceTimer = null;
        this._ipcTimer = null;
        this._resourceCpuBaseline = null;
        this._renderWindow = [];
        this._report = {
            rendering: {
                current: null,
                history: [],
                status: {
                    avatarVisible: false,
                    documentHidden: typeof document !== 'undefined' ? document.hidden : false,
                },
            },
            voice: {
                current: null,
                history: [],
                status: {
                    idle: true,
                    activeTurnId: null,
                    lastTurnCompletedAt: null,
                },
            },
            resources: {
                current: null,
                history: [],
                status: {
                    sampling: false,
                },
            },
            ipc: {
                current: null,
                history: [],
                status: {
                    sampling: false,
                },
            },
        };
    }
    exposeGlobal(target = window) {
        if (!target)
            return;
        target.getIrisBenchmarks = () => this.getReport();
    }
    getReport() {
        return clone({
            generatedAt: new Date().toISOString(),
            uptimeMs: Date.now() - this._startedAt,
            ...this._report,
        });
    }
    recordFrame({ deltaMs, avatarVisible = true, documentHidden = false } = {}) {
        this._report.rendering.status.avatarVisible = !!avatarVisible;
        this._report.rendering.status.documentHidden = !!documentHidden;
        if (!avatarVisible || documentHidden || !Number.isFinite(deltaMs) || deltaMs <= 0) {
            this._renderWindow.length = 0;
            return;
        }
        this._renderWindow.push(deltaMs);
        if (this._renderWindow.length < RENDER_SAMPLE_WINDOW)
            return;
        const deltas = this._renderWindow.splice(0, this._renderWindow.length);
        const avgDeltaMs = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
        const sample = {
            recordedAt: new Date().toISOString(),
            frames: deltas.length,
            avgFps: round(1000 / avgDeltaMs, 2),
            avgDeltaMs: round(avgDeltaMs, 2),
            minDeltaMs: round(Math.min(...deltas), 2),
            maxDeltaMs: round(Math.max(...deltas), 2),
        };
        pushHistory(this._report.rendering, sample);
        (0, logger_js_1.metric)('Rendering', sample);
    }
    beginVoiceTurn(meta = {}) {
        const turnId = meta.turnId || `voice-${Date.now()}`;
        this._report.voice.status.idle = false;
        this._report.voice.status.activeTurnId = turnId;
        return {
            id: turnId,
            startedAt: performance.now(),
            captureEndedAt: 0,
            requestStartedAt: 0,
            firstChunkAt: 0,
            playbackStartedAt: 0,
            firstChunkType: null,
            meta: {
                source: meta.source || 'user',
            },
        };
    }
    cancelVoiceTurn(turn) {
        if (!turn)
            return;
        if (this._report.voice.status.activeTurnId !== turn.id)
            return;
        this._report.voice.status.idle = true;
        this._report.voice.status.activeTurnId = null;
    }
    completeVoiceTurn(turn) {
        if (!turn || !turn.captureEndedAt || !turn.requestStartedAt)
            return null;
        const sample = {
            recordedAt: new Date().toISOString(),
            turnId: turn.id,
            source: turn.meta?.source || 'user',
            captureEndToRequestStartMs: round(turn.requestStartedAt - turn.captureEndedAt, 2),
            requestStartToFirstChunkMs: turn.firstChunkAt ? round(turn.firstChunkAt - turn.requestStartedAt, 2) : null,
            totalToPlaybackStartMs: turn.playbackStartedAt ? round(turn.playbackStartedAt - turn.captureEndedAt, 2) : null,
            firstChunkType: turn.firstChunkType || null,
        };
        pushHistory(this._report.voice, sample);
        this._report.voice.status.idle = true;
        this._report.voice.status.activeTurnId = null;
        this._report.voice.status.lastTurnCompletedAt = sample.recordedAt;
        (0, logger_js_1.metric)('VoiceBenchmark', sample);
        return sample;
    }
    recordResourceSample(sample = {}) {
        const next = {
            recordedAt: new Date().toISOString(),
            memory: sample.memory || null,
            cpu: sample.cpu || null,
            rendererHeap: sample.rendererHeap || null,
        };
        pushHistory(this._report.resources, next);
        (0, logger_js_1.metric)('ResourceBenchmark', next);
    }
    recordIpcSample(sample = {}) {
        const next = {
            recordedAt: new Date().toISOString(),
            rendererRoundTripMs: round(sample.rendererRoundTripMs, 2),
            mainEventBusRoundTripMs: round(sample.mainEventBusRoundTripMs, 2),
        };
        pushHistory(this._report.ipc, next);
        (0, logger_js_1.metric)('IpcBenchmark', next);
    }
    startBackgroundSampling() {
        this.stopBackgroundSampling();
        this._scheduleResourceSample(0);
        this._scheduleIpcSample(250);
    }
    stopBackgroundSampling() {
        if (this._resourceTimer) {
            clearTimeout(this._resourceTimer);
            this._resourceTimer = null;
        }
        if (this._ipcTimer) {
            clearTimeout(this._ipcTimer);
            this._ipcTimer = null;
        }
    }
    _scheduleResourceSample(delayMs = RESOURCE_SAMPLE_INTERVAL_MS) {
        if (this._resourceTimer)
            clearTimeout(this._resourceTimer);
        this._resourceTimer = setTimeout(() => {
            this._resourceTimer = null;
            this._runIdle(() => this._sampleResources());
        }, delayMs);
    }
    _scheduleIpcSample(delayMs = IPC_SAMPLE_INTERVAL_MS) {
        if (this._ipcTimer)
            clearTimeout(this._ipcTimer);
        this._ipcTimer = setTimeout(() => {
            this._ipcTimer = null;
            this._runIdle(() => this._sampleIpc());
        }, delayMs);
    }
    _runIdle(task) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => task(), { timeout: 2000 });
            return;
        }
        setTimeout(task, 0);
    }
    async _sampleResources() {
        if (!this._getResourceMetrics) {
            this._scheduleResourceSample();
            return;
        }
        this._report.resources.status.sampling = true;
        try {
            const metrics = await this._getResourceMetrics();
            const cpu = metrics?.cpu || null;
            let cpuSample = null;
            if (cpu && this._resourceCpuBaseline) {
                const cumulativeDelta = cpu.cumulativeCPUUsage - this._resourceCpuBaseline.cumulativeCPUUsage;
                const elapsedMicros = Math.max(1, cpu.timestampMicros - this._resourceCpuBaseline.timestampMicros);
                cpuSample = {
                    percentApprox: round((cumulativeDelta / elapsedMicros) * 100, 2),
                    cumulativeMicros: round(cpu.cumulativeCPUUsage, 2),
                };
            }
            this._resourceCpuBaseline = cpu || this._resourceCpuBaseline;
            this.recordResourceSample({
                memory: {
                    privateMiB: toMiB(metrics?.processMemory?.private),
                    residentSetMiB: toMiB(metrics?.nodeMemory?.rss),
                    heapUsedMiB: toMiB(metrics?.nodeMemory?.heapUsed),
                    heapTotalMiB: toMiB(metrics?.nodeMemory?.heapTotal),
                },
                cpu: cpuSample,
                rendererHeap: pickRendererHeap(metrics?.rendererPerformanceMemory),
            });
        }
        catch { }
        this._report.resources.status.sampling = false;
        this._scheduleResourceSample();
    }
    async _sampleIpc() {
        if (!this._pingIpc) {
            this._scheduleIpcSample();
            return;
        }
        this._report.ipc.status.sampling = true;
        try {
            const sample = await this._pingIpc();
            if (sample)
                this.recordIpcSample(sample);
        }
        catch { }
        this._report.ipc.status.sampling = false;
        this._scheduleIpcSample();
    }
}
exports.PerformanceMonitor = PerformanceMonitor;
function createPerformanceMonitor(options) {
    return new PerformanceMonitor(options);
}
