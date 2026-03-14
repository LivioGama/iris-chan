"use strict";
const log = require('../logger');
const avatarWindow = require('../windows/avatar-window');
const kanbanWindow = require('../windows/kanban-window');
const { getConvexClient: getUnifiedConvexClient } = require('../runtime/convex-adapter');
const DEFAULT_COUNTDOWN_SECONDS = 10;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const QUEUE_TASK_FIELDS = new Set([
    'projectPath',
    'rawPrompt',
    'enrichedPrompt',
    'impactedFiles',
    'complexity',
    'taskKind',
    'executionLane',
    'hireableProfile',
    'intake',
    'execution',
    'status',
    'origin',
    'launchMode',
    'resumable',
    'resumeCount',
    'dependencyState',
    'dependencies',
    'inferredDependencies',
    'blockedBy',
    'startedAt',
    'resumedAt',
    'result',
    'errorMessage',
    'createdAt',
    'updatedAt',
]);
let behaviorEngineRef = null;
const countdowns = new Map();
const EXECUTION_LANE_ALIASES = Object.freeze({
    core: 'core',
    skill: 'skill',
    memory: 'memory',
    safety: 'safety',
    research: 'research-observability',
    observability: 'research-observability',
    'research-observability': 'research-observability',
    research_observability: 'research-observability',
    'research/observability': 'research-observability',
});
const EXECUTION_LANE_DEFAULTS = Object.freeze({
    coding: Object.freeze({ lane: 'skill', profile: 'workflow-generalist', queueBucket: 'implementation' }),
    ui: Object.freeze({ lane: 'safety', profile: 'safety-guardian', queueBucket: 'safety-review' }),
    voice: Object.freeze({ lane: 'memory', profile: 'memory-architect', queueBucket: 'memory-intake' }),
    frustration: Object.freeze({ lane: 'research-observability', profile: 'observability-researcher', queueBucket: 'friction-research' }),
});
function setBehaviorEngine(engine) {
    behaviorEngineRef = engine;
}
function getConvexClient() {
    return getUnifiedConvexClient();
}
function getBehaviorEngine() {
    return behaviorEngineRef;
}
function sanitizeQueueTaskFields(record = {}) {
    return Object.fromEntries(Object.entries(record).filter(([key, value]) => QUEUE_TASK_FIELDS.has(key) && value !== undefined));
}
function normalizeText(value = '') {
    return String(value || '').trim();
}
function normalizeStringList(values) {
    if (!Array.isArray(values))
        return [];
    return values
        .map((value) => normalizeText(value))
        .filter(Boolean);
}
function normalizeTaskKind(taskKind = '') {
    const normalized = normalizeText(taskKind).toLowerCase();
    return normalized || 'coding';
}
function inferExecutionLaneFromContent({ rawPrompt = '', intake = {}, taskKind = 'coding' } = {}) {
    const normalizedTaskKind = normalizeTaskKind(taskKind);
    if (normalizedTaskKind !== 'coding') {
        return EXECUTION_LANE_DEFAULTS[normalizedTaskKind]?.lane || 'skill';
    }
    const text = normalizeText([rawPrompt, intake?.summary, intake?.utterance].filter(Boolean).join(' ')).toLowerCase();
    if (/\bmemory|remember|policy|context|history|recall\b/.test(text))
        return 'memory';
    if (/\bsafety|guardrail|permission|verify|verification|risk|danger|destructive\b/.test(text))
        return 'safety';
    if (/\bresearch|observability|instrument|telemetry|runtime|logs?|metrics|benchmark|evidence|debug\b/.test(text))
        return 'research-observability';
    return 'skill';
}
function normalizeExecutionLane(value = '', taskKind = 'coding') {
    const normalized = normalizeText(value).replace(/\s+/g, '-');
    if (normalized && EXECUTION_LANE_ALIASES[normalized])
        return EXECUTION_LANE_ALIASES[normalized];
    return EXECUTION_LANE_DEFAULTS[normalizeTaskKind(taskKind)]?.lane || 'skill';
}
function normalizeHireableProfile(value = '', taskKind = 'coding', executionLane = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized)
        return normalized;
    const lane = normalizeExecutionLane(executionLane, taskKind);
    const laneDefault = Object.values(EXECUTION_LANE_DEFAULTS).find((entry) => entry.lane === lane);
    return laneDefault?.profile || EXECUTION_LANE_DEFAULTS[normalizeTaskKind(taskKind)]?.profile || 'workflow-generalist';
}
function normalizeQueueBucket(value = '', taskKind = 'coding', executionLane = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized)
        return normalized;
    const lane = normalizeExecutionLane(executionLane, taskKind);
    const laneDefault = Object.values(EXECUTION_LANE_DEFAULTS).find((entry) => entry.lane === lane);
    return laneDefault?.queueBucket || EXECUTION_LANE_DEFAULTS[normalizeTaskKind(taskKind)]?.queueBucket || 'implementation';
}
function normalizeIntakeMetadata(intake = {}, rawPrompt = '') {
    if (!intake || typeof intake !== 'object' || Array.isArray(intake))
        return undefined;
    const normalized = {
        source: normalizeText(intake.source || intake.channel || ''),
        mode: normalizeText(intake.mode || ''),
        appHint: normalizeText(intake.appHint || ''),
        summary: normalizeText(intake.summary || rawPrompt || ''),
        dedupeKey: normalizeText(intake.dedupeKey || ''),
        utterance: normalizeText(intake.utterance || ''),
        capturedAt: Number.isFinite(Number(intake.capturedAt)) ? Number(intake.capturedAt) : undefined,
        frustration: intake.frustration === true,
        frustrationSignals: normalizeStringList(intake.frustrationSignals),
        confidence: Number.isFinite(Number(intake.confidence)) ? Number(intake.confidence) : undefined,
    };
    return Object.values(normalized).some((value) => {
        if (Array.isArray(value))
            return value.length > 0;
        return value !== undefined && value !== '' && value !== false;
    }) ? normalized : undefined;
}
function createExecutionMetadata(execution = {}) {
    const fallbackCount = Math.max(0, Number(execution.fallbackCount || 0));
    const interruptionCount = Math.max(0, Number(execution.interruptionCount || 0));
    const strategy = normalizeText(execution.strategy || 'queued');
    const executionLane = normalizeExecutionLane(execution.executionLane || execution.lane, execution.taskKind);
    const hireableProfile = normalizeHireableProfile(execution.hireableProfile || execution.profile, execution.taskKind, executionLane);
    const queueBucket = normalizeQueueBucket(execution.queueBucket, execution.taskKind, executionLane);
    return {
        strategy,
        lastEvent: normalizeText(execution.lastEvent || 'created'),
        lastErrorCode: normalizeText(execution.lastErrorCode || ''),
        lastAttemptAt: Number.isFinite(Number(execution.lastAttemptAt)) ? Number(execution.lastAttemptAt) : undefined,
        startedAt: Number.isFinite(Number(execution.startedAt)) ? Number(execution.startedAt) : undefined,
        completedAt: Number.isFinite(Number(execution.completedAt)) ? Number(execution.completedAt) : undefined,
        executionLane,
        hireableProfile,
        queueBucket,
        fallbackCount,
        interruptionCount,
    };
}
function getBroadcastTargets() {
    return [avatarWindow.get(), kanbanWindow.get()].filter(Boolean).filter((win, index, all) => {
        return all.findIndex((candidate) => candidate.webContents?.id === win.webContents?.id) === index;
    });
}
function broadcastTaskUpdate(update) {
    const targets = getBroadcastTargets();
    for (const win of targets) {
        if (!win.isDestroyed()) {
            win.webContents.send('tq:task-update', update);
        }
    }
    // Also notify reconciled catalog
    try {
        const { getCatalogService } = require('../controllers/kanbanController');
        getCatalogService()?.broadcastUpdate(update);
    }
    catch {
        // Controller might not be ready
    }
}
function broadcastCountdown(taskId, remaining) {
    const targets = getBroadcastTargets();
    for (const win of targets) {
        if (!win.isDestroyed()) {
            win.webContents.send('tq:countdown-state', { taskId, remaining });
        }
    }
}
function clearCountdown(taskId) {
    const cd = countdowns.get(taskId);
    if (cd) {
        clearInterval(cd.timer);
        countdowns.delete(taskId);
    }
}
async function approveQueuedTask(taskId, patch = {}) {
    clearCountdown(taskId);
    const convexClient = getConvexClient();
    if (!convexClient)
        return { ok: false, error: 'No Convex client' };
    const result = await convexClient.updateQueueTask(taskId, {
        status: 'queued',
        dependencyState: 'ready',
        updatedAt: Date.now(),
        ...patch,
    });
    broadcastTaskUpdate({ taskId, status: 'queued', dependencyState: 'ready', ...patch });
    return { ok: result.ok };
}
async function cancelQueuedTask(taskId, reason = 'Cancelled by user') {
    clearCountdown(taskId);
    const convexClient = getConvexClient();
    if (!convexClient)
        return { ok: false, error: 'No Convex client' };
    const result = await convexClient.updateQueueTask(taskId, {
        status: 'cancelled',
        errorMessage: reason,
        updatedAt: Date.now(),
    });
    broadcastTaskUpdate({ taskId, status: 'cancelled', errorMessage: reason });
    return { ok: result.ok };
}
async function resolveProjectPath({ projectPath, resolveProjectPath: resolver }) {
    if (projectPath)
        return projectPath;
    if (typeof resolver === 'function') {
        const resolved = await resolver();
        if (resolved)
            return resolved;
    }
    throw new Error('Could not resolve project path');
}
function startCountdown(taskId, options = {}) {
    clearCountdown(taskId);
    let remaining = Number(options.countdownSeconds || DEFAULT_COUNTDOWN_SECONDS);
    const tickMs = Number(options.countdownTickMs || DEFAULT_COUNTDOWN_TICK_MS);
    const timer = setInterval(async () => {
        remaining--;
        broadcastCountdown(taskId, remaining);
        if (remaining <= 0) {
            clearCountdown(taskId);
            const convexClient = getConvexClient();
            if (!convexClient)
                return;
            try {
                const allTasks = await convexClient.getAllQueueTasks();
                const current = allTasks.ok && allTasks.value?.find((task) => String(task._id) === String(taskId));
                if (current && current.status === 'draft') {
                    await approveQueuedTask(taskId);
                    log.info('TaskQueue', `Auto-approved task ${taskId}`);
                }
                else {
                    log.info('TaskQueue', `Skipped auto-approve for ${taskId} (status: ${current?.status || 'not found'})`);
                }
            }
            catch (err) {
                log.warn('TaskQueue', `Auto-approve check failed for ${taskId}: ${err.message}`);
            }
        }
    }, tickMs);
    countdowns.set(taskId, { timer, remaining });
}
async function createQueuedTask(options) {
    const { rawPrompt, projectPath, resolveProjectPath: resolver, origin, taskKind, intake, dependencies = [], extraTaskFields = {}, buildEnrichmentPatch, countdownSeconds, countdownTickMs, } = options || {};
    const convexClient = getConvexClient();
    if (!convexClient) {
        throw new Error('Convex client not initialized');
    }
    const resolvedPath = await resolveProjectPath({ projectPath, resolveProjectPath: resolver });
    const createdAt = Date.now();
    const normalizedTaskKind = normalizeTaskKind(taskKind || extraTaskFields.taskKind);
    const normalizedIntake = normalizeIntakeMetadata(intake || extraTaskFields.intake, rawPrompt);
    const inferredExecutionLane = inferExecutionLaneFromContent({
        rawPrompt,
        intake: normalizedIntake,
        taskKind: normalizedTaskKind,
    });
    const taskRecord = {
        projectPath: resolvedPath,
        rawPrompt,
        taskKind: normalizedTaskKind,
        executionLane: normalizeExecutionLane(options.executionLane || extraTaskFields.executionLane || inferredExecutionLane, normalizedTaskKind),
        hireableProfile: normalizeHireableProfile(options.hireableProfile || extraTaskFields.hireableProfile, normalizedTaskKind, options.executionLane || extraTaskFields.executionLane || inferredExecutionLane),
        intake: normalizedIntake,
        execution: createExecutionMetadata({
            ...extraTaskFields.execution,
            strategy: options.strategy || extraTaskFields.execution?.strategy || 'watcher-executor',
            taskKind: normalizedTaskKind,
            executionLane: options.executionLane || extraTaskFields.executionLane || inferredExecutionLane,
            hireableProfile: options.hireableProfile || extraTaskFields.hireableProfile,
            queueBucket: options.queueBucket || extraTaskFields.queueBucket,
        }),
        status: 'draft',
        origin,
        launchMode: 'queued',
        resumable: true,
        resumeCount: 0,
        dependencyState: 'pending',
        dependencies: Array.isArray(dependencies) ? dependencies.filter(Boolean) : [],
        inferredDependencies: [],
        blockedBy: [],
        createdAt,
        updatedAt: createdAt,
        ...extraTaskFields,
    };
    const persistedTaskRecord = sanitizeQueueTaskFields(taskRecord);
    const idempotencyKey = `tq_${createdAt}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await convexClient.createQueueTask(persistedTaskRecord, idempotencyKey);
    if (!result.ok) {
        throw new Error(result.error || 'Failed to create task');
    }
    const taskId = result.value;
    broadcastTaskUpdate({
        taskId,
        created: true,
        status: 'draft',
        task: {
            _id: taskId,
            ...persistedTaskRecord,
        },
    });
    const isDirectMode = behaviorEngineRef?.getDirectMode?.() ?? false;
    (async () => {
        try {
            const { enrichPrompt } = require('../task-queue/enricher');
            const enriched = await enrichPrompt(rawPrompt, resolvedPath);
            const convexClient = getConvexClient();
            const enrichmentPatch = sanitizeQueueTaskFields({
                enrichedPrompt: enriched.enrichedPrompt,
                impactedFiles: enriched.impactedFiles,
                complexity: enriched.complexity,
                dependencyState: 'ready',
                updatedAt: Date.now(),
                ...(typeof buildEnrichmentPatch === 'function' ? buildEnrichmentPatch(enriched) : {}),
            });
            await convexClient.updateQueueTask(taskId, enrichmentPatch);
            broadcastTaskUpdate({
                taskId,
                enriched: true,
                ...enrichmentPatch,
            });
            log.info('TaskQueue', `Enriched task ${taskId}: ${enriched.complexity}`);
        }
        catch (err) {
            log.warn('TaskQueue', `Enrichment failed for ${taskId}: ${err.message}`);
        }
        if (isDirectMode) {
            log.info('TaskQueue', `Direct mode: auto-queuing task ${taskId} (no countdown)`);
            await approveQueuedTask(taskId);
        }
        else {
            startCountdown(taskId, { countdownSeconds, countdownTickMs });
        }
    })().catch((err) => {
        log.warn('TaskQueue', `Background task flow failed for ${taskId}: ${err.message}`);
    });
    return { taskId, projectPath: resolvedPath };
}
async function createVoiceQueuedTask(options = {}) {
    const utterance = normalizeText(options.utterance || options.rawPrompt);
    const summary = normalizeText(options.summary || options.rawPrompt || utterance);
    if (!summary) {
        throw new Error('No voice task summary provided');
    }
    return createQueuedTask({
        ...options,
        rawPrompt: summary,
        taskKind: 'voice',
        executionLane: options.executionLane || 'memory',
        hireableProfile: options.hireableProfile || 'memory-architect',
        queueBucket: options.queueBucket || 'memory-intake',
        intake: {
            ...options.intake,
            source: options.intake?.source || 'voice',
            mode: options.intake?.mode || 'extracted-task',
            summary,
            utterance,
            appHint: options.appHint || options.intake?.appHint || '',
            confidence: options.confidence ?? options.intake?.confidence,
            capturedAt: options.capturedAt || options.intake?.capturedAt || Date.now(),
        },
    });
}
async function createFrustrationQueuedTask(options = {}) {
    const summary = normalizeText(options.summary || options.rawPrompt);
    if (!summary) {
        throw new Error('No frustration task summary provided');
    }
    return createQueuedTask({
        ...options,
        rawPrompt: summary,
        taskKind: 'frustration',
        executionLane: options.executionLane || 'research-observability',
        hireableProfile: options.hireableProfile || 'observability-researcher',
        queueBucket: options.queueBucket || 'friction-research',
        intake: {
            ...options.intake,
            source: options.intake?.source || 'voice',
            mode: options.intake?.mode || 'frustration-capture',
            summary,
            utterance: options.utterance || options.intake?.utterance || '',
            frustration: true,
            frustrationSignals: options.signals || options.intake?.frustrationSignals || [],
            appHint: options.appHint || options.intake?.appHint || '',
            confidence: options.confidence ?? options.intake?.confidence,
            capturedAt: options.capturedAt || options.intake?.capturedAt || Date.now(),
        },
    });
}
module.exports = {
    setBehaviorEngine,
    getConvexClient,
    getBehaviorEngine,
    broadcastTaskUpdate,
    broadcastCountdown,
    createQueuedTask,
    createVoiceQueuedTask,
    createFrustrationQueuedTask,
    approveQueuedTask,
    cancelQueuedTask,
    clearCountdown,
    startCountdown,
    createExecutionMetadata,
    normalizeExecutionLane,
    normalizeHireableProfile,
    normalizeIntakeMetadata,
};
