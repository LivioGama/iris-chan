const assert = require('node:assert');
const Module = require('node:module');

console.log('Running bootstrap runtime persistence tests...');

const originalLoad = Module._load;
const savedRuntimeEvents = [];
const savedTaskMilestones = [];
const savedProactiveSuggestions = [];
let registeredEventHandler = null;

class FakeRuntimeEventBus {
	constructor() {
		this.handlers = new Map();
	}

	on(eventName, handler) {
		this.handlers.set(eventName, handler);
		if (eventName === 'event') registeredEventHandler = handler;
	}

	emitEvent(type, payload, source) {
		const handler = this.handlers.get('event');
		if (!handler) return;
		handler({
			type,
			payload,
			source,
			timestamp: Date.now(),
		});
	}
}

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'electron') {
		return {
			app: {
				whenReady() {
					return new Promise(() => {});
				},
				on() {},
				quit() {},
			},
			session: {
				defaultSession: {
					setPermissionRequestHandler() {},
				},
			},
			systemPreferences: {
				askForMediaAccess: async () => true,
			},
			globalShortcut: {
				register() {},
				unregisterAll() {},
			},
		};
	}
	if (request === 'child_process') {
		return { exec() {} };
	}
	if (request === './windows/avatar-window' || request === './windows/kanban-window') {
		return {
			create() {
				return {
					isDestroyed() { return false; },
					reload() {},
					webContents: { send() {} },
					isVisible() { return false; },
					hide() {},
					showInactive() {},
					focus() {},
				};
			},
			get() {
				return {
					isDestroyed() { return false; },
					reload() {},
					webContents: { send() {} },
					isVisible() { return false; },
					hide() {},
					showInactive() {},
					focus() {},
				};
			},
		};
	}
	if (request === './skills') {
		return { scan() {} };
	}
	if (request === './ipc') {
		return { register() {} };
	}
	if (request === './convex-store') {
		return { init() {}, shutdown() {} };
	}
	if (request === '../shared/event-bus') {
		return { RuntimeEventBus: FakeRuntimeEventBus };
	}
	if (request === './convex-client') {
		return {
			ConvexClient: class FakeConvexClient {
				async saveRuntimeEvent(event, idempotencyKey) {
					savedRuntimeEvents.push({ event, idempotencyKey });
					return { ok: true };
				}

				async saveTaskMilestone(taskMilestone, idempotencyKey) {
					savedTaskMilestones.push({ taskMilestone, idempotencyKey });
					return { ok: true };
				}

				async saveProactiveSuggestion(suggestion, idempotencyKey) {
					savedProactiveSuggestions.push({ suggestion, idempotencyKey });
					return { ok: true };
				}
			},
		};
	}
	if (request === './tasks/task-engine') {
		return { TaskEngine: class FakeTaskEngine {} };
	}
	if (request === './runtime/health-service') {
		return { HealthService: class FakeHealthService { start() {} stop() {} } };
	}
	if (request === './autonomy/daily-loop') {
		return { DailyLoop: class FakeDailyLoop { start() {} stop() {} } };
	}
	if (request === './autonomy/ghost-draft-publisher') {
		return { createGhostDraft: async () => ({ ok: true }) };
	}
	if (request === './status-tray') {
		return {
			createTrayController() {
				return {
					create() {},
					destroy() {},
					shouldKeepAlive() { return false; },
				};
			},
		};
	}
	if (request === './ipc-runtime') {
		return { registerIpc() {} };
	}
	if (request === './runtime/behavior-mode') {
		return {
			BehaviorModeState: class FakeBehaviorModeState {
				setMode() {}
				setDirectMode() {}
				setState() {}
				getMode() { return 'silent'; }
				getDirectMode() { return false; }
				getState() {
					return {
						mode: 'silent',
						directMode: false,
						feedbackEnabled: false,
						introversionEnabled: false,
					};
				}
			},
		};
	}
	if (request === './automation/ui-task-service') {
		return { UITaskService: class FakeUITaskService {} };
	}
	if (request === './automation/self-improvement-manager') {
		return { SelfImprovementManager: class FakeSelfImprovementManager {} };
	}
	if (request === './automation/memory-store') {
		return { MemoryStore: class FakeMemoryStore {} };
	}
	if (request === './automation/learning-manager') {
		return { LearningManager: class FakeLearningManager {} };
	}
	if (request === './automation/native-fallback-manager') {
		return { NativeFallbackManager: class FakeNativeFallbackManager {} };
	}
	if (request === './automation/episode-recorder') {
		return { EpisodeRecorder: class FakeEpisodeRecorder {} };
	}
	if (request === './automation/service-ref') {
		return {
			setUiTaskService() {},
			setSelfImprovementManager() {},
			setMemoryStore() {},
			setLearningManager() {},
			setNativeFallbackManager() {},
			setEpisodeRecorder() {},
			setConvexClient() {},
		};
	}
	if (request === './task-queue/watcher') {
		return {
			start() {},
			stop() {},
			restartWithNewInterval() {},
		};
	}
	if (request === './controllers/taskQueueController') {
		return {
			setConvexClient() {},
			setBehaviorEngine() {},
		};
	}
	if (request === './tools/task-queue') {
		return { setConvexClient() {} };
	}
	if (request === './task-queue/service') {
		return { setBehaviorEngine() {} };
	}
	if (request === './settings') {
		return {
			registerApplyHandler() {},
			init() {
				return {
					behavior: {
						mode: 'silent',
						directMode: false,
					},
				};
			},
			updateSettings() {},
		};
	}
	return originalLoad.apply(this, arguments);
};

const { startRuntime } = require('../src/main/bootstrap.js');

startRuntime({ apiKey: 'test-key' });

assert.ok(registeredEventHandler, 'bootstrap should subscribe to runtime events');

registeredEventHandler({
	type: 'DB_HEALTH',
	timestamp: 111,
	payload: { ok: true, latencyMs: 8 },
	source: 'health-service',
});
registeredEventHandler({
	type: 'TASK_MILESTONE',
	timestamp: 222,
	payload: { taskId: 'task-1', message: 'Verification passed cleanly', importance: 'high', status: 'verified' },
	source: 'task-engine',
});
registeredEventHandler({
	type: 'TASK_DONE',
	timestamp: 333,
	payload: { taskId: 'task-1', message: 'done after verification', importance: 'medium', status: 'completed' },
	source: 'task-engine',
});
registeredEventHandler({
	type: 'PROACTIVE_SUGGESTION',
	timestamp: 444,
	payload: {
		suggestion: 'Run the focused verification file before switching context.',
		confidence: 0.91,
		accepted: true,
		kind: 'next-step',
		context: { app: 'Visual Studio Code - iris-chan' },
	},
	source: 'proactive-engine',
});

assert.strictEqual(savedRuntimeEvents.length, 4, 'every runtime event should be mirrored to Convex');
assert.deepStrictEqual(savedRuntimeEvents[0], {
	event: {
		type: 'DB_HEALTH',
		timestamp: 111,
		payload: JSON.stringify({ ok: true, latencyMs: 8 }),
		source: 'health-service',
	},
	idempotencyKey: 'runtime_evt_111_0_DB_HEALTH',
});

assert.strictEqual(savedTaskMilestones.length, 2, 'task milestone and task done events should persist milestone records');
assert.deepStrictEqual(savedTaskMilestones[0], {
	taskMilestone: {
		taskId: 'task-1',
		message: 'Verification passed cleanly',
		importance: 'high',
		status: 'verified',
		timestamp: 222,
	},
	idempotencyKey: 'task_milestone_task-1_222',
});
assert.deepStrictEqual(savedTaskMilestones[1], {
	taskMilestone: {
		taskId: 'task-1',
		message: 'done after verification',
		importance: 'medium',
		status: 'completed',
		timestamp: 333,
	},
	idempotencyKey: 'task_milestone_task-1_333',
});

assert.strictEqual(savedProactiveSuggestions.length, 1, 'proactive suggestions should persist separately');
assert.deepStrictEqual(savedProactiveSuggestions[0], {
	suggestion: {
		text: 'Run the focused verification file before switching context.',
		confidence: 0.91,
		context: JSON.stringify({
			kind: 'next-step',
			app: 'Visual Studio Code - iris-chan',
		}),
		accepted: true,
		timestamp: 444,
	},
	idempotencyKey: 'proactive_444',
});

console.log('Bootstrap runtime persistence tests passed.');

Module._load = originalLoad;
