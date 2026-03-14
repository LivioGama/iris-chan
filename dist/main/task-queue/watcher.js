"use strict";
const log = require('../logger');
const { executeTask } = require('./executor');
const { buildCodingPrompt } = require('../coding/prompt');
const avatarWindow = require('../windows/avatar-window');
const kanbanWindow = require('../windows/kanban-window');
const { READY_STATUSES, classifyDependencyState, getTaskIdentifier, inferDependencies, } = require('./dependency-manager');
const { createExecutionMetadata } = require('./service');
const { getConvexClient } = require('../runtime/convex-adapter');
const POLL_INTERVAL_NORMAL_MS = 3000;
const POLL_INTERVAL_DIRECT_MS = 1000;
const EXECUTION_LANE_CAPACITY = Object.freeze({
    core: 2,
    skill: 4,
    memory: 2,
    safety: 2,
    'research-observability': 2,
});
const EXECUTION_LANE_PRIORITY = Object.freeze({
    safety: 0,
    core: 1,
    memory: 2,
    'research-observability': 3,
    skill: 4,
});
let pollTimer = null;
let behaviorEngineRef = null;
let polling = false;
const activeTaskIds = new Set();
const activeTaskLanes = new Map();
function getConvex() {
    return getConvexClient();
}
function broadcastTaskUpdate(update) {
    const seen = new Set();
    const targets = [avatarWindow.get(), kanbanWindow.get()].filter(Boolean);
    for (const win of targets) {
        if (win.isDestroyed())
            continue;
        const webContentsId = win.webContents?.id;
        if (seen.has(webContentsId))
            continue;
        seen.add(webContentsId);
        win.webContents.send('tq:task-update', update);
    }
}
function buildPrompt(task) {
    return buildCodingPrompt({
        description: task.enrichedPrompt || task.rawPrompt,
        cwd: task.projectPath,
    });
}
function isTerminalStatus(status = '') {
    return ['completed', 'failed', 'cancelled'].includes(String(status).toLowerCase());
}
function buildExecutionPatch(task = {}, updates = {}) {
    return createExecutionMetadata({
        ...(task.execution || {}),
        taskKind: task.taskKind,
        executionLane: task.executionLane || task.execution?.executionLane,
        hireableProfile: task.hireableProfile || task.execution?.hireableProfile,
        ...updates,
    });
}
function getExecutionLane(task = {}) {
    return String(task.executionLane || task.execution?.executionLane || 'skill').toLowerCase();
}
function countActiveTasksByLane() {
    const counts = new Map();
    for (const lane of activeTaskLanes.values()) {
        counts.set(lane, (counts.get(lane) || 0) + 1);
    }
    return counts;
}
async function syncDependencyStates(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [getTaskIdentifier(task), task]));
    const convex = getConvex();
    for (const task of tasks) {
        const taskId = getTaskIdentifier(task);
        const status = String(task.status || '').toLowerCase();
        if (!taskId || status === 'draft' || isTerminalStatus(status))
            continue;
        const inferredDependencies = inferDependencies(task, tasks);
        const normalizedTask = {
            ...task,
            inferredDependencies,
        };
        const { blockedBy, dependencyState } = classifyDependencyState(normalizedTask, taskMap);
        const shouldBlock = blockedBy.length > 0;
        const nextStatus = shouldBlock ? 'blocked' : (status === 'blocked' ? 'queued' : status);
        const statusChanged = nextStatus !== status;
        const dependenciesChanged = JSON.stringify(task.inferredDependencies || []) !== JSON.stringify(inferredDependencies)
            || JSON.stringify(task.blockedBy || []) !== JSON.stringify(blockedBy)
            || String(task.dependencyState || '') !== dependencyState;
        if (!statusChanged && !dependenciesChanged)
            continue;
        await convex.updateQueueTask(task._id, {
            status: nextStatus,
            inferredDependencies,
            blockedBy,
            dependencyState,
            execution: buildExecutionPatch(task, {
                lastEvent: shouldBlock ? 'dependency_blocked' : 'dependency_ready',
                lastAttemptAt: Date.now(),
            }),
            updatedAt: Date.now(),
        });
        task.status = nextStatus;
        task.inferredDependencies = inferredDependencies;
        task.blockedBy = blockedBy;
        task.dependencyState = dependencyState;
        broadcastTaskUpdate({
            taskId,
            status: nextStatus,
            inferredDependencies,
            blockedBy,
            dependencyState,
        });
        log.info('TaskQueue', `Updated dependency state for ${taskId}: ${nextStatus} (${blockedBy.length} blockers)`);
    }
}
async function dispatchRunnableTasks(tasks = []) {
    const laneActiveCounts = countActiveTasksByLane();
    const runnable = tasks
        .filter((task) => {
        const taskId = getTaskIdentifier(task);
        const status = String(task.status || '').toLowerCase();
        const executionLane = getExecutionLane(task);
        const laneCapacity = EXECUTION_LANE_CAPACITY[executionLane] || EXECUTION_LANE_CAPACITY.skill;
        return taskId
            && READY_STATUSES.has(status)
            && !activeTaskIds.has(taskId)
            && String(task.dependencyState || 'ready') === 'ready'
            && (laneActiveCounts.get(executionLane) || 0) < laneCapacity;
    })
        .sort((left, right) => {
        const lanePriority = (EXECUTION_LANE_PRIORITY[getExecutionLane(left)] || 99)
            - (EXECUTION_LANE_PRIORITY[getExecutionLane(right)] || 99);
        if (lanePriority !== 0)
            return lanePriority;
        return Number(left.createdAt || 0) - Number(right.createdAt || 0);
    });
    for (const task of runnable) {
        const taskId = getTaskIdentifier(task);
        const currentStatus = String(task.status || '').toLowerCase();
        const executionLane = getExecutionLane(task);
        const laneCapacity = EXECUTION_LANE_CAPACITY[executionLane] || EXECUTION_LANE_CAPACITY.skill;
        if ((laneActiveCounts.get(executionLane) || 0) >= laneCapacity)
            continue;
        const convex = getConvex();
        const claim = await convex.claimQueueTask(task._id, [currentStatus], {
            status: 'running',
            startedAt: task.startedAt || Date.now(),
            resumedAt: currentStatus === 'resuming' ? Date.now() : undefined,
            execution: buildExecutionPatch(task, {
                strategy: 'watcher-executor',
                lastEvent: currentStatus === 'resuming' ? 'resumed' : 'started',
                startedAt: task.startedAt || Date.now(),
                lastAttemptAt: Date.now(),
            }),
            updatedAt: Date.now(),
        });
        if (!claim.ok || claim.value?.ok === false)
            continue;
        activeTaskIds.add(taskId);
        activeTaskLanes.set(taskId, executionLane);
        laneActiveCounts.set(executionLane, (laneActiveCounts.get(executionLane) || 0) + 1);
        broadcastTaskUpdate({
            taskId,
            status: 'running',
            startedAt: task.startedAt || Date.now(),
            executionLane,
        });
        log.info('TaskQueue', `Dispatching task ${taskId} (${currentStatus}, lane=${executionLane}) for ${task.projectPath}`);
        (async () => {
            try {
                const prompt = buildPrompt(task);
                const result = await executeTask(taskId, prompt, task.projectPath, (line) => {
                    log.info('TaskQueue', `[${taskId}] ${line.substring(0, 100)}`);
                }, task.execution?.strategy || 'watcher-executor');
                const convex = getConvex();
                await convex.updateQueueTask(task._id, {
                    status: (result.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
                    result: result.summary || '',
                    dependencyState: 'ready',
                    execution: buildExecutionPatch(task, {
                        strategy: 'watcher-executor',
                        lastEvent: (result.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
                        completedAt: Date.now(),
                        lastAttemptAt: Date.now(),
                    }),
                    updatedAt: Date.now(),
                });
                broadcastTaskUpdate({
                    taskId,
                    status: (result.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
                    result: result.summary || '',
                    dependencyState: 'ready',
                });
            }
            catch (err) {
                log.error('TaskQueue', `Task ${taskId} failed: ${err.message}`);
                const convex = getConvex();
                await convex.updateQueueTask(task._id, {
                    status: 'failed',
                    errorMessage: err.message,
                    dependencyState: 'ready',
                    execution: buildExecutionPatch(task, {
                        strategy: 'watcher-executor',
                        lastEvent: 'failed',
                        lastErrorCode: err.code || 'task_failed',
                        completedAt: Date.now(),
                        lastAttemptAt: Date.now(),
                    }),
                    updatedAt: Date.now(),
                }).catch(() => { });
                broadcastTaskUpdate({
                    taskId,
                    status: 'failed',
                    errorMessage: err.message,
                    dependencyState: 'ready',
                });
            }
            finally {
                activeTaskIds.delete(taskId);
                activeTaskLanes.delete(taskId);
            }
        })();
    }
}
async function recoverInterruptedTasks() {
    const convex = getConvex();
    const result = await convex.getAllQueueTasks();
    if (!result.ok || !Array.isArray(result.value))
        return;
    const interrupted = result.value.filter((task) => String(task.status || '').toLowerCase() === 'running' && task.resumable !== false);
    for (const task of interrupted) {
        const taskId = getTaskIdentifier(task);
        await convex.updateQueueTask(task._id, {
            status: 'resuming',
            resumeCount: Number(task.resumeCount || 0) + 1,
            execution: buildExecutionPatch(task, {
                strategy: 'watcher-executor',
                lastEvent: 'interrupted_recovered',
                interruptionCount: Number(task.execution?.interruptionCount || 0) + 1,
                lastAttemptAt: Date.now(),
            }),
            updatedAt: Date.now(),
        });
        broadcastTaskUpdate({
            taskId,
            status: 'resuming',
            resumeCount: Number(task.resumeCount || 0) + 1,
        });
    }
    if (interrupted.length) {
        log.info('TaskQueue', `Recovered ${interrupted.length} interrupted queued task(s)`);
    }
}
async function poll() {
    const convex = getConvex();
    if (!convex || polling)
        return;
    polling = true;
    try {
        const result = await convex.getAllQueueTasks();
        if (!result.ok || !Array.isArray(result.value) || result.value.length === 0)
            return;
        const tasks = result.value;
        await syncDependencyStates(tasks);
        await dispatchRunnableTasks(tasks);
    }
    catch (err) {
        log.error('TaskQueue', `Poll error: ${err.message}`);
    }
    finally {
        polling = false;
    }
}
function getCurrentPollInterval() {
    const isDirect = behaviorEngineRef?.getDirectMode?.() ?? false;
    return isDirect ? POLL_INTERVAL_DIRECT_MS : POLL_INTERVAL_NORMAL_MS;
}
function start(convexClient, behaviorEngine) {
    behaviorEngineRef = behaviorEngine || null;
    log.info('TaskQueue', `Watcher started (poll interval: ${getCurrentPollInterval()}ms)`);
    recoverInterruptedTasks().catch((err) => {
        log.warn('TaskQueue', `Recovery failed: ${err.message}`);
    });
    pollTimer = setInterval(poll, getCurrentPollInterval());
    setTimeout(() => poll(), 0);
}
function restartWithNewInterval() {
    if (pollTimer)
        clearInterval(pollTimer);
    const interval = getCurrentPollInterval();
    log.info('TaskQueue', `Watcher restarted with poll interval: ${interval}ms`);
    pollTimer = setInterval(poll, interval);
    setTimeout(() => poll(), 0);
}
function stop() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    activeTaskIds.clear();
    activeTaskLanes.clear();
    log.info('TaskQueue', 'Watcher stopped');
}
module.exports = { start, stop, restartWithNewInterval };
