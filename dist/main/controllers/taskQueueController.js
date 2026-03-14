"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TQ_CHANNELS = void 0;
exports.setConvexClient = setConvexClient;
exports.setBehaviorEngine = setBehaviorEngine;
exports.register = register;
const electron_1 = require("electron");
const log = __importStar(require("../logger"));
const taskQueueService = require('../task-queue/service');
const TQ_CHANNELS = {
    CREATE_TASK: 'tq:create-task',
    APPROVE_TASK: 'tq:approve-task',
    CANCEL_TASK: 'tq:cancel-task',
    DETECT_PATH: 'tq:detect-path',
    GET_ALL: 'tq:get-all',
    GET_BY_PROJECT: 'tq:get-by-project',
    TASK_UPDATE: 'tq:task-update',
    COUNTDOWN_STATE: 'tq:countdown-state',
};
exports.TQ_CHANNELS = TQ_CHANNELS;
function setConvexClient(client) {
    taskQueueService.setConvexClient(client);
}
function setBehaviorEngine(engine) {
    taskQueueService.setBehaviorEngine(engine);
}
function register() {
    // Create a new task: detect path, create draft, enrich, start countdown
    electron_1.ipcMain.handle(TQ_CHANNELS.CREATE_TASK, async (_, rawPrompt, projectPathOverride) => {
        try {
            const created = await taskQueueService.createQueuedTask({
                rawPrompt,
                projectPath: projectPathOverride,
                origin: 'ipc:create-task',
                resolveProjectPath: async () => {
                    const { detectHoveredPath } = require('../task-queue/path-detector');
                    const detection = await detectHoveredPath();
                    if (!detection.ok) {
                        throw new Error(detection.error || 'Could not detect project path');
                    }
                    return detection.projectPath;
                },
            });
            return { ok: true, taskId: created.taskId, projectPath: created.projectPath };
        }
        catch (err) {
            log.error('TaskQueue', `Create task error: ${err.message}`);
            return { ok: false, error: err.message };
        }
    });
    // Approve task immediately (skip countdown)
    electron_1.ipcMain.handle(TQ_CHANNELS.APPROVE_TASK, async (_, taskId) => {
        return taskQueueService.approveQueuedTask(taskId);
    });
    // Cancel task
    electron_1.ipcMain.handle(TQ_CHANNELS.CANCEL_TASK, async (_, taskId) => {
        return taskQueueService.cancelQueuedTask(taskId);
    });
    // Detect hovered path
    electron_1.ipcMain.handle(TQ_CHANNELS.DETECT_PATH, async () => {
        const { detectHoveredPath } = require('../task-queue/path-detector');
        return detectHoveredPath();
    });
    // Get all tasks
    electron_1.ipcMain.handle(TQ_CHANNELS.GET_ALL, async () => {
        const convexClient = taskQueueService.getConvexClient();
        if (!convexClient)
            return { ok: false, error: 'No Convex client' };
        return convexClient.getAllQueueTasks();
    });
    // Get by project
    electron_1.ipcMain.handle(TQ_CHANNELS.GET_BY_PROJECT, async (_, projectPath) => {
        const convexClient = taskQueueService.getConvexClient();
        if (!convexClient)
            return { ok: false, error: 'No Convex client' };
        return convexClient.getQueueTasksByProject(projectPath);
    });
}
