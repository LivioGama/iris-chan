"use strict";
const path = require('node:path');
const workspace = require('../workspace');
const { buildCodingPrompt } = require('../coding/prompt');
const { startCodingTask } = require('../coding/runner');
const { STATUS, loadTasksFile, normalizeTaskRecord, writeTasksFile } = require('../tasks/task-state');
const { buildScientificTaskMetadata, deriveObjective, normalizeTaskText } = require('../coding/scientific-workflow');
function getIrisDir() {
    return path.resolve(__dirname, '..', '..', '..');
}
async function fix_project(args) {
    const description = normalizeTaskText(args.description);
    if (!description)
        return { ok: false, result: 'No description provided' };
    if (description.length < 30)
        return { ok: false, result: 'Description too short. Provide detailed context: what to fix/build, expected behavior, files involved. Minimum 30 characters.' };
    const target = args.target || 'workspace';
    // Allow explicit cwd override (e.g., from kanban RUN_TASK to match kanban's tasks.json path)
    const cwd = args._cwd || (target === 'iris' ? getIrisDir() : workspace.get());
    const scientificMetadata = args.scientific_metadata || buildScientificTaskMetadata({ description, target, projectPath: cwd });
    const objective = scientificMetadata.objective || deriveObjective(description);
    const prompt = buildCodingPrompt({ description, cwd, target });
    const tasksPath = path.join(cwd, 'tasks.json');
    try {
        let data = loadTasksFile(tasksPath, { cwd });
        let taskId;
        let taskRecord;
        if (args._taskId) {
            taskId = args._taskId;
            const existing = data.tasks.find((t) => t.id === taskId);
            if (existing) {
                existing.status = STATUS.RUNNING;
                existing.logs = '';
                existing.startedAt = new Date().toISOString();
                existing.updatedAt = new Date().toISOString();
                existing.origin = 'self_fix';
                existing.launchMode = 'immediate';
                existing.resumable = true;
                existing.projectPath = cwd;
                existing.schedulerSource = 'fix_project';
                existing.prompt = prompt;
                existing.dependencyState = existing.dependencyState || 'ready';
                existing.objective = objective;
                existing.workflow = scientificMetadata.workflow || 'ai_scientist_v1';
                existing.workflowStage = 'running';
                existing.scientificMetadata = scientificMetadata;
                existing.autoVerify = args.auto_verify !== false;
                existing.selfReview = args.self_review !== false;
                existing.reproducibility = scientificMetadata.reproducibility || null;
                taskRecord = existing;
            }
        }
        else {
            let maxId = 0;
            for (const task of data.tasks) {
                if (task.id?.startsWith('task-')) {
                    const num = Number.parseInt(task.id.split('-')[1]);
                    if (!Number.isNaN(num))
                        maxId = Math.max(maxId, num);
                }
            }
            taskId = `task-${maxId + 1}`;
            taskRecord = normalizeTaskRecord({
                id: taskId,
                title: description.split('\n')[0].substring(0, 80),
                description,
                status: STATUS.RUNNING,
                order: data.tasks.length + 1,
                files: [],
                action: '',
                verify: '',
                done: '',
                logs: '',
                dependsOn: [],
                dependencies: [],
                inferredDependencies: [],
                dependencyState: 'ready',
                origin: 'self_fix',
                launchMode: 'immediate',
                resumable: true,
                resumeCount: 0,
                startedAt: new Date().toISOString(),
                projectPath: cwd,
                schedulerSource: 'fix_project',
                prompt,
                objective,
                workflow: scientificMetadata.workflow || 'ai_scientist_v1',
                workflowStage: 'running',
                scientificMetadata,
                autoVerify: args.auto_verify !== false,
                selfReview: args.self_review !== false,
                reproducibility: scientificMetadata.reproducibility || null,
                blockedBy: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }, { cwd });
            data.tasks.push(taskRecord);
        }
        writeTasksFile(tasksPath, data);
        if (args._runSDK) {
            args._runSDK(prompt, cwd, tasksPath, taskId, scientificMetadata);
        }
        else {
            runCodingTask(prompt, cwd, tasksPath, taskId, scientificMetadata);
        }
        const title = description.split('\n')[0].substring(0, 80);
        return {
            ok: true,
            result: `✓ Task started: ${taskId} — ${title}\nWorkflow: hypothesis -> experiment -> verify -> self-review.\nTrack live progress in Kanban (Ctrl+K).`,
        };
    }
    catch (err) {
        return { ok: false, result: `fix_project error: ${err.message}` };
    }
}
function runCodingTask(prompt, cwd, tasksPath, taskId, scientificMetadata = null) {
    let logBuffer = '';
    let flushTimer = null;
    const workflowPrefix = scientificMetadata ? [
        `[workflow] ${scientificMetadata.workflow || 'ai_scientist_v1'} objective: ${scientificMetadata.objective || 'n/a'}`,
        '[workflow] stages: hypothesis -> experiment -> implementation -> verification -> self-review',
        '[workflow] reproducibility: record verification evidence, consider version-control state, and note restart/container implications when relevant',
    ].join('\n') : '';
    const flushLogs = () => {
        try {
            const freshData = loadTasksFile(tasksPath, { cwd });
            const task = (freshData.tasks || []).find((t) => t.id === taskId);
            if (task) {
                const lines = logBuffer.split('\n');
                if (lines.length > 50)
                    logBuffer = lines.slice(-50).join('\n');
                task.logs = logBuffer;
                task.updatedAt = new Date().toISOString();
                writeTasksFile(tasksPath, freshData);
            }
        }
        catch { }
    };
    const updateStatus = (status) => {
        clearTimeout(flushTimer);
        try {
            const freshData = loadTasksFile(tasksPath, { cwd });
            const task = (freshData.tasks || []).find((t) => t.id === taskId);
            if (task) {
                task.status = status === 'COMPLETED' ? STATUS.COMPLETED : STATUS.FAILED;
                task.logs = logBuffer;
                task.updatedAt = new Date().toISOString();
                task.dependencyState = 'ready';
                task.workflowStage = status === 'COMPLETED' ? 'completed' : 'failed';
                writeTasksFile(tasksPath, freshData);
            }
        }
        catch { }
    };
    if (workflowPrefix)
        logBuffer = workflowPrefix;
    const handle = startCodingTask({
        taskId,
        prompt,
        cwd,
        onLog: (line, nextLogBuffer) => {
            logBuffer = workflowPrefix ? `${workflowPrefix}\n${nextLogBuffer}` : nextLogBuffer;
            if (!flushTimer) {
                flushTimer = setTimeout(() => {
                    flushTimer = null;
                    flushLogs();
                }, 2000);
            }
        },
        onDone: ({ status, logBuffer: finalLogBuffer }) => {
            logBuffer = workflowPrefix ? `${workflowPrefix}\n${finalLogBuffer}` : finalLogBuffer;
            updateStatus(status);
        },
    });
    handle.completion.finally(() => {
        clearTimeout(flushTimer);
    });
    return handle;
}
function resumeImmediateTasks({ cwd = workspace.get(), _runSDK } = {}) {
    const tasksPath = path.join(cwd, 'tasks.json');
    const data = loadTasksFile(tasksPath, { cwd });
    const resumableTasks = data.tasks.filter((task) => (task.resumable !== false
        && task.launchMode === 'immediate'
        && ['running', 'resuming'].includes(task.status)));
    if (!resumableTasks.length)
        return { ok: true, resumed: 0 };
    for (const task of resumableTasks) {
        task.status = STATUS.RESUMING;
        task.resumeCount = Number(task.resumeCount || 0) + 1;
        task.updatedAt = new Date().toISOString();
        task.logs = `${task.logs || ''}${task.logs ? '\n' : ''}⚠️ Resuming after app restart`;
    }
    writeTasksFile(tasksPath, data);
    for (const task of resumableTasks) {
        const prompt = task.prompt || buildCodingPrompt({ description: task.description || task.title || '', cwd, target: 'workspace' });
        if (_runSDK) {
            _runSDK(prompt, cwd, tasksPath, task.id, task.scientificMetadata || null);
        }
        else {
            runCodingTask(prompt, cwd, tasksPath, task.id, task.scientificMetadata || null);
        }
    }
    return { ok: true, resumed: resumableTasks.length };
}
module.exports = { fix_project, getIrisDir, resumeImmediateTasks };
