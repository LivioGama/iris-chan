const { EventEmitter } = require('node:events');
const { EVENT_TYPES } = require('../../shared/event-types.js');
const { runHelper } = require('../native-helper');
const { open_app, resolveDefaultApp } = require('../tools/apps');
const filesTools = require('../tools/files');
const log = require('../logger');
const { BrowserAdapter } = require('./browser-adapter');
const { InputMonitor } = require('./input-monitor');
const { isNativeEligiblePlan, isNativeEligibleStep, resolverIdForStep } = require('./native-resolver-registry');
const { planLikelySatisfiesGoal } = require('./skill-policy');
const { WorldState } = require('./world-state');
const screenCapture = require('../screen-capture');
const { requestTarsAction, validateTarsImagePoint, getTarsConfig } = require('./tars-client');

const { PlanningEngine, createPlanSignature, createTaskSignature } = require('./planning-engine');
const { ExecutionPolicy } = require('./execution-policy');
const { VerificationEngine } = require('./verification-engine');
const { makeTaskError, throwIfAborted, stepLabel } = require('./ui-task-service-utils');

function createTaskId() {
	return `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function didBrowserPageChange(beforeInfo, afterInfo) {
	if (!beforeInfo?.ok || !afterInfo?.ok) return false;
	const beforeUrl = String(beforeInfo.href || '');
	const afterUrl = String(afterInfo.href || '');
	if (beforeUrl && afterUrl && beforeUrl !== afterUrl) return true;
	const beforeTitle = String(beforeInfo.title || '');
	const afterTitle = String(afterInfo.title || '');
	return Boolean(beforeTitle && afterTitle && beforeTitle !== afterTitle);
}

function parseJsonResult(text, fallback = null) {
	if (typeof text !== 'string') return fallback;
	try {
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}

function wait(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason || makeTaskError('UI task interrupted', 'aborted'));
			return;
		}
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(signal.reason || makeTaskError('UI task interrupted', 'aborted'));
		};
		const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
		signal?.addEventListener?.('abort', onAbort, { once: true });
	});
}

function toScreenPoint(x, y, captureId) {
	const mapping = screenCapture.getMapping(captureId);
	if (!mapping) return null;
	return {
		x: Math.round(x * mapping.scaleX + (mapping.offsetX || 0)),
		y: Math.round(y * mapping.scaleY + (mapping.offsetY || 0)),
	};
}

function classifyOpenAppDomain(appName = '', resolverId = '') {
	if (resolverId === 'editor.activate') return 'editor';
	if (resolverId === 'system.default_app') return 'system';
	if (['System Settings', 'Activity Monitor', 'Console', 'Disk Utility', 'System Information'].includes(String(appName || ''))) {
		return 'system';
	}
	return 'general';
}

class UITaskService extends EventEmitter {
	constructor({ eventBus, selfImprovementManager = null, nativeFallbackManager = null, episodeRecorder = null, deps = {} } = {}) {
		super();
		this.eventBus = eventBus;
		this.selfImprovementManager = selfImprovementManager;
		this.nativeFallbackManager = nativeFallbackManager;
		this.episodeRecorder = episodeRecorder;
		this._screenCapture = deps.screenCapture || screenCapture;
		this._requestTarsAction = deps.requestTarsAction || requestTarsAction;
		this._validateTarsImagePoint = deps.validateTarsImagePoint || validateTarsImagePoint;
		this._performRescueClick = deps.performRescueClick || ((point) => runHelper({
			action: 'click_at',
			x: point.x,
			y: point.y,
			button: 'left',
		}));
		this._mapRescuePoint = deps.mapRescuePoint || ((x, y, captureId) => toScreenPoint(x, y, captureId));
		this._getTarsConfig = deps.getTarsConfig || getTarsConfig;
		this.browserAdapter = new BrowserAdapter();
		this.worldState = new WorldState();

		this.planningEngine = new PlanningEngine(this);
		this.executionPolicy = new ExecutionPolicy(this);
		this.verificationEngine = new VerificationEngine(this);

		this.activeTask = null;
		this.lastCompletedTask = null;
		this.inputMonitor = new InputMonitor({
			onInput: (payload) => {
				if (!this.activeTask) return;
				const kind = payload?.type || 'user input';
				this.stopActiveTask(`User ${kind} interrupted the task`);
			},
		});
	}

	getState() {
		const active = this.activeTask;
		return {
			ok: true,
			active: active ? {
				taskId: active.taskId,
				goal: active.goal,
				status: active.status,
				currentStepIndex: active.currentStepIndex,
				totalSteps: active.plan.steps.length,
				startedAt: active.startedAt,
			} : null,
		};
	}

	subscribeStream(listener) {
		this.on('ui-task-stream', listener);
		return () => this.off('ui-task-stream', listener);
	}

	_emitStream(payload) {
		this.emit('ui-task-stream', payload);
	}

	_emitMilestone(taskId, message, extra = {}) {
		const payload = {
			taskId,
			message,
			importance: extra.importance || 'medium',
			status: extra.status || 'running',
			taskKind: 'ui',
		};
		this.eventBus?.emitEvent?.(EVENT_TYPES.TASK_MILESTONE, payload, 'ui-task-service');
		this._emitStream({ taskId, type: 'milestone', message, ...extra });
	}

	_emitDone(taskId, status, summary, extra = {}) {
		const payload = {
			taskId,
			message: summary,
			importance: extra.importance || 'high',
			status,
			taskKind: 'ui',
		};
		this.eventBus?.emitEvent?.(EVENT_TYPES.TASK_DONE, payload, 'ui-task-service');
		this._emitStream({ taskId, type: 'done', status, summary, ...extra });
	}

	async runTask({ goal, app_hint: appHint = '', success_signal: successSignal = '' } = {}) {
		const normalizedGoal = String(goal || '').trim();
		if (!normalizedGoal) {
			return { ok: false, result: 'No UI task goal provided' };
		}
		let learnedEntry = null;
		let recoveredFromSkillFailure = false;
		const explicitAppHint = String(appHint || '').trim();
		const routeAppHint = explicitAppHint || (await this.planningEngine.getRouteAppHint());

		if (this.selfImprovementManager) {
			learnedEntry = this.selfImprovementManager.findMatchingSkill({ goal: normalizedGoal, appHint: routeAppHint || explicitAppHint });
			const learnedPlan = this.selfImprovementManager.buildPlanFromSkill(learnedEntry, {
				goal: normalizedGoal,
				appHint: routeAppHint || explicitAppHint,
				successSignal,
			});
			if (learnedEntry && learnedPlan) {
				log.info('Learning', `Using learned UI skill first: id=${learnedEntry.id} name=${learnedEntry.name} goal=${normalizedGoal}`);
				const learnedRun = await this._runPlannedTask({
					goal: normalizedGoal,
					plan: learnedPlan,
					planSource: 'learned-skill',
					sourceSkill: learnedEntry,
				});
				if (learnedRun.ok) {
					if (!planLikelySatisfiesGoal(normalizedGoal, learnedPlan)) {
						log.info('Learning', `Learned skill produced false-positive success, falling back to builtin planner: id=${learnedEntry.id} goal=${normalizedGoal}`);
						this.selfImprovementManager.recordLearnedOutcome(learnedEntry, false, {
							successType: 'false_positive',
							reason: `Plan does not satisfy goal: ${normalizedGoal}`,
							result: learnedRun.result,
						});
						recoveredFromSkillFailure = true;
					} else {
						this.selfImprovementManager.recordLearnedOutcome(learnedEntry, true, { result: learnedRun.result });
						return learnedRun;
					}
				}
				if (!recoveredFromSkillFailure) {
					log.info('Learning', `Learned UI skill failed, falling back to builtin planner: id=${learnedEntry.id} reason=${learnedRun.result}`);
					this.selfImprovementManager.recordLearnedOutcome(learnedEntry, false, { error: learnedRun.result });
					recoveredFromSkillFailure = true;
				}
			}
		}
		const planned = this.planningEngine.createPlan({ goal: normalizedGoal, appHint: explicitAppHint || routeAppHint, successSignal });
		if (!planned.ok) {
			return { ok: false, result: planned.error };
		}
		const builtinRun = await this._runPlannedTask({
			goal: normalizedGoal,
			plan: planned.plan,
			planSource: 'builtin',
			sourceSkill: null,
		});
		if (builtinRun.ok && this.selfImprovementManager) {
			this.selfImprovementManager.recordSuccessfulPlan({
				goal: normalizedGoal,
				appHint: explicitAppHint || routeAppHint || planned.plan.appHint,
				plan: planned.plan,
				usedLearnedSkill: false,
				recoveredFromSkillFailure,
			});
			if (recoveredFromSkillFailure && learnedEntry) {
				log.info('Learning', `Builtin planner recovered after learned skill failure: replacing id=${learnedEntry.id}`);
				this.selfImprovementManager.replaceSkill(learnedEntry, {
					goal: normalizedGoal,
					purpose: learnedEntry.description,
					preferredExecutionPath: { type: 'ui-plan', plan: planned.plan },
				});
			}
		}
		return builtinRun;
	}

	async _runPlannedTask({ goal, plan, planSource = 'builtin', sourceSkill = null } = {}) {
		const signature = this.planningEngine.createPlanSignature(plan);
		if (this.activeTask) {
			if (this.activeTask.signature === signature) {
				return {
					ok: true,
					result: `UI task already running: ${this.activeTask.goal}`,
					taskId: this.activeTask.taskId,
				};
			}
			return { ok: false, result: 'A UI task is already running' };
		}
		if (this.lastCompletedTask && this.lastCompletedTask.signature === signature && Date.now() - this.lastCompletedTask.completedAt < 6000) {
			return {
				ok: this.lastCompletedTask.ok,
				result: this.lastCompletedTask.result,
				taskId: this.lastCompletedTask.taskId,
			};
		}

		const taskId = createTaskId();
		const controller = new AbortController();
		const activeTask = {
			taskId,
			goal,
			status: 'running',
			startedAt: Date.now(),
			currentStepIndex: 0,
			plan,
			trace: [],
			signature,
			controller,
			planSource,
			sourceSkillId: sourceSkill?.id || null,
			nativeEligible: isNativeEligiblePlan(plan),
			episodeId: this.episodeRecorder?.beginEpisode?.({
				taskId,
				goal,
				appHint: plan.appHint || '',
			}) || null,
		};
		this.activeTask = activeTask;
		this.nativeFallbackManager?.beginTask?.({
			taskId,
			goal,
			appHint: plan.appHint || '',
			nativeEligible: activeTask.nativeEligible,
		});
		this.worldState.invalidate();

		this._emitMilestone(taskId, `UI task started: ${goal}`, { plan, planSource, sourceSkillId: sourceSkill?.id || null });

		try {
			await this.inputMonitor.start();
			const summary = await this._executePlan(activeTask);
			activeTask.status = 'completed';
			this.lastCompletedTask = {
				signature,
				taskId,
				ok: true,
				result: summary,
				completedAt: Date.now(),
			};
			this._emitDone(taskId, 'completed', summary, { trace: activeTask.trace });
			this.episodeRecorder?.finishEpisode?.(taskId, { ok: true, result: summary, successType: 'true_success' });
			return { ok: true, result: summary, taskId, planSource, sourceSkillId: sourceSkill?.id || null };
		} catch (err) {
			const code = err?.code || 'ui_task_failed';
			const summary = err?.message || 'UI task failed';
			if (activeTask.nativeEligible && err?.pointerFallbackEligible) {
				this.nativeFallbackManager?.authorizePointerFallback?.({
					taskId,
					reason: err.pointerFallbackReason || summary,
				});
			}
			activeTask.status = code === 'aborted' ? 'cancelled' : 'failed';
			this.lastCompletedTask = {
				signature,
				taskId,
				ok: false,
				result: summary,
				completedAt: Date.now(),
			};
			if (code === 'aborted') {
				this.eventBus?.emitEvent?.(EVENT_TYPES.INTERRUPT, {
					taskId,
					reason: summary,
					taskKind: 'ui',
				}, 'ui-task-service');
			}
			this._emitDone(taskId, activeTask.status, summary, { errorCode: code, trace: activeTask.trace });
			this.episodeRecorder?.finishEpisode?.(taskId, {
				ok: false,
				result: summary,
				successType: code === 'aborted' ? 'technical_success' : 'false_positive',
			});
			return { ok: false, result: summary, taskId, planSource, sourceSkillId: sourceSkill?.id || null };
		} finally {
			this.inputMonitor.stop();
			this.worldState.invalidate();
			if (!this.activeTask || this.activeTask.taskId === taskId) {
				this.nativeFallbackManager?.endTask?.(taskId, {
					preserveAuthorization: activeTask.status === 'failed',
				});
			}
			this.activeTask = null;
		}
	}

	stopActiveTask(reason = 'User interrupted the task') {
		if (!this.activeTask) return { ok: true, result: 'No active UI task' };
		if (!this.activeTask.controller.signal.aborted) {
			this.activeTask.controller.abort(makeTaskError(reason, 'aborted'));
		}
		return { ok: true, result: `Stopping ${this.activeTask.taskId}` };
	}

	async _executePlan(activeTask) {
		const { plan, controller, taskId } = activeTask;
		for (let i = 0; i < plan.steps.length; i++) {
			throwIfAborted(controller.signal);
			const step = plan.steps[i];
			const executionContract = this.executionPolicy.buildExecutionContract(plan, step, this._isTarsRescueEnabled());
			this.executionPolicy.enforceSafetyContract(plan, step, executionContract);
			activeTask.currentStepIndex = i;
			this._emitMilestone(taskId, `Step ${i + 1}/${plan.steps.length}: ${stepLabel(step)}`, {
				step,
				stepIndex: i,
				executionContract,
			});
			const outcome = await this._executeStepWithContract({
				taskId,
				plan,
				step,
				executionContract,
				signal: controller.signal,
			});
			log.info('Learning', `Step outcome: task=${taskId} step=${step.type} tier=${outcome.tier || 'unknown'} domain=${outcome.domain || 'general'} resolver=${outcome.resolverId || 'n/a'} successType=${outcome.successType || 'true_success'}`);
			activeTask.trace.push({
				stepId: step.id,
				type: step.type,
				safetyClass: executionContract.safetyClass,
				checkpointKind: executionContract.checkpointKind,
				fallbackTiers: executionContract.fallbackTiers,
				tier: outcome.tier || 'unknown',
				domain: outcome.domain || 'general',
				resolverId: outcome.resolverId || '',
				verificationMode: outcome.verificationMode || '',
				successType: outcome.successType || 'true_success',
				resolutionMethod: outcome.resolutionMethod || 'input',
				result: outcome.result,
				fallbackTrail: outcome.fallbackTrail || [],
				tarsRescue: outcome.tarsRescue || null,
			});
			this.episodeRecorder?.recordAttempt?.(taskId, {
				stepId: step.id,
				type: step.type,
				safetyClass: executionContract.safetyClass,
				tier: outcome.tier || 'unknown',
				domain: outcome.domain || 'general',
				resolverId: outcome.resolverId || '',
				verificationMode: outcome.verificationMode || '',
				successType: outcome.successType || 'true_success',
				result: outcome.result,
				fallbackTrail: outcome.fallbackTrail || [],
				tarsRescue: outcome.tarsRescue || null,
			});
			this.worldState.invalidate();
		}

		if (plan.successSignal) {
			await this.verificationEngine.verifySuccessSignal(plan, controller.signal);
		}

		const lastTrace = activeTask.trace[activeTask.trace.length - 1];
		return lastTrace?.result || `Completed UI task: ${plan.goal}`;
	}

	async _executeStepWithContract({ taskId, plan, step, executionContract, signal }) {
		const fallbackTrail = [];
		if (executionContract.primaryTier === 'tars') {
			const tarsAttempt = await this._attemptPrimaryTars({
				taskId,
				plan,
				step,
				signal,
			});
			if (tarsAttempt.ok) {
				return {
					...tarsAttempt.outcome,
					fallbackTrail,
				};
			}
			fallbackTrail.push({
				tier: 'tars',
				status: 'failed',
				code: tarsAttempt.error?.code || 'tars_primary_failed',
				reason: tarsAttempt.error?.message || 'Primary TARS attempt failed',
			});
			this._emitMilestone(taskId, `Primary TARS attempt failed for ${stepLabel(step)}; falling back to semantic execution`, {
				importance: 'medium',
				status: 'running',
				step,
				fallbackTrail,
			});
		}

		try {
			const outcome = await this._executeStep(step, signal);
			if (step.checkpoint) {
				await this.verificationEngine.verifyCheckpoint(plan, step, outcome, signal);
			}
			return {
				...outcome,
				fallbackTrail,
			};
		} catch (err) {
			if (executionContract.primaryTier === 'tars') {
				const gatedError = makeTaskError(err.message || 'Semantic fallback failed after primary TARS execution', err.code || 'ui_task_failed', {
					fallbackTrail,
				});
				if (err.tarsRescue) gatedError.tarsRescue = err.tarsRescue;
				throw gatedError;
			}
			const rescued = await this._attemptTarsRescue({
				taskId,
				plan,
				step,
				error: err,
				signal,
			});
			if (!rescued.ok) {
				rescued.error.fallbackTrail = fallbackTrail;
				throw rescued.error;
			}
			return {
				...rescued.outcome,
				fallbackTrail,
			};
		}
	}

	async _executeStep(step, signal) {
		switch (step.type) {
			case 'openApp':
				return this._executeOpenApp(step, signal);
			case 'resolveSystemDefault':
				return this._executeResolveSystemDefault(step, signal);
			case 'openUrl':
				return this._executeOpenUrl(step, signal);
			case 'clickElement':
			case 'selectItemByText':
				return this._executeClickByText(step, signal);
			case 'setElementValue':
				return this._executeSetValue(step, signal);
			case 'searchInCurrentContext':
				return this._executeSearchInContext(step, signal);
			case 'clickSearchResult':
				return this._executeClickSearchResult(step, signal);
			case 'navigateHistory':
				return this._executeNavigateHistory(step, signal);
			case 'scrollUntilVisible':
				return this._executeScrollUntilVisible(step, signal);
			case 'mediaControl':
				return this._executeMediaControl(step, signal);
			case 'editorCommand':
				return this._executeEditorCommand(step, signal);
			case 'cleanupInstallArtifact':
				return this._executeCleanupInstallArtifact(step, signal);
			default:
				throw makeTaskError(`Unsupported UI step: ${step.type}`, 'unsupported_step');
		}
	}

	async _executeOpenApp(step, signal) {
		throwIfAborted(signal);
		const appName = step.appName || step.appHint;
		const result = await open_app({ name: appName });
		if (result.ok === false) {
			throw makeTaskError(result.result || `Could not open ${appName}`, 'open_app_failed');
		}
		await wait(250, signal);
		return {
			ok: true,
			tier: 'native',
			domain: classifyOpenAppDomain(appName, resolverIdForStep(step, appName)),
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'frontmost-app',
			successType: 'true_success',
			resolutionMethod: 'input',
			result: result.result || `Opened ${appName}`,
			resolvedAppName: result.resolved_name || appName,
		};
	}

	async _executeResolveSystemDefault(step, signal) {
		throwIfAborted(signal);
		const queryName = step.kind === 'mail' ? 'default mail' : 'default browser';
		const resolved = resolveDefaultApp(queryName);
		if (!resolved.ok) {
			throw makeTaskError(resolved.error || `Could not resolve ${queryName}`, 'system_query_failed');
		}
		await wait(80, signal);
		return {
			ok: true,
			tier: 'native',
			domain: 'system',
			resolverId: resolverIdForStep(step),
			verificationMode: 'system-default-query',
			successType: 'true_success',
			resolutionMethod: resolved.source,
			result: `Resolved default ${resolved.kind} app to ${resolved.appName}`,
			resolvedAppName: resolved.appName,
		};
	}

	async _executeOpenUrl(step, signal) {
		throwIfAborted(signal);
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = step.appHint || (frontmost.ok ? frontmost.name : '') || 'Safari';
		const adapterResult = this.browserAdapter.openUrl({ appName, url: step.url });
		if (!adapterResult.ok) {
			throw makeTaskError(adapterResult.error, adapterResult.code || 'open_url_failed');
		}
		await wait(350, signal);
		return {
			...adapterResult,
			tier: 'native',
			domain: 'browser',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'browser-navigation',
			successType: 'true_success',
		};
	}

	async _executeClickByText(step, signal) {
		throwIfAborted(signal);
		const targetText = step.selector?.text || '';
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : step.appHint || '';

		if (appName === 'Finder') {
			const finderResult = step.type === 'selectItemByText'
				? await filesTools.finder_select_item({ name: targetText })
				: await filesTools.finder_open_item({ name: targetText });
			if (finderResult.ok) {
				await wait(120, signal);
				return {
					ok: true,
					tier: 'native',
					domain: 'finder',
					resolverId: resolverIdForStep(step, appName),
					verificationMode: 'finder-selection',
					successType: 'true_success',
					resolutionMethod: 'native',
					result: finderResult.result,
					path: finderResult.path || '',
				};
			}
		}

		if (this.browserAdapter.isSupported(appName)) {
			const browserResult = this.browserAdapter.clickByText({ appName, text: targetText });
			if (browserResult.ok) {
				await wait(200, signal);
				return browserResult;
			}
			if (browserResult.code === 'ambiguous') {
				throw this._makePointerEligibleError(
					`Multiple matches for "${targetText}": ${(browserResult.matches || []).join(', ')}`,
					'ambiguous',
					{ matches: browserResult.matches || [] }
				);
			}
		}

		const axResult = await runHelper({
			action: 'ax_press',
			query: targetText,
			role: step.selector?.role || '',
			exact: step.selector?.exact === true,
		});
		if (axResult.ok === false) {
			throw this._makePointerEligibleError(axResult.result || `Could not click "${targetText}"`, 'ax_press_failed');
		}
		const parsed = parseJsonResult(axResult.result, null);
		if (parsed?.ambiguous) {
			throw this._makePointerEligibleError(
				`Multiple matches for "${targetText}": ${(parsed.matches || []).join(', ')}`,
				'ambiguous',
				{ matches: parsed.matches || [] }
			);
		}
		await wait(150, signal);
		return {
			ok: true,
			tier: 'ax_dom',
			domain: isNativeEligibleStep(step) ? 'browser' : 'general',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'accessibility',
			successType: 'true_success',
			resolutionMethod: 'accessibility',
			result: parsed?.message || `Activated "${targetText}"`,
		};
	}

	async _executeSetValue(step, signal) {
		throwIfAborted(signal);
		if (step.selector?.text) {
			await runHelper({
				action: 'ax_focus',
				query: step.selector.text,
				role: step.selector.role || '',
				exact: step.selector.exact === true,
			});
		}
		const axResult = await runHelper({
			action: 'ax_set_value',
			query: step.selector?.text || '',
			role: step.selector?.role || '',
			exact: step.selector?.exact === true,
			value: step.value,
		});
		if (axResult.ok !== false) {
			const parsed = parseJsonResult(axResult.result, null);
			return {
				ok: true,
				tier: 'ax_dom',
				domain: 'general',
				resolverId: resolverIdForStep(step),
				verificationMode: 'accessibility',
				successType: 'true_success',
				resolutionMethod: 'accessibility',
				result: parsed?.message || `Typed "${step.value}"`,
			};
		}

		const fallback = await runHelper({ action: 'type_text', text: step.value });
		if (fallback.ok === false) {
			throw makeTaskError(fallback.result || `Could not type "${step.value}"`, 'set_value_failed');
		}
		return {
			ok: true,
			tier: 'ax_dom',
			domain: 'general',
			resolverId: resolverIdForStep(step),
			verificationMode: 'input',
			successType: 'technical_success',
			resolutionMethod: 'input',
			result: fallback.result || `Typed "${step.value}"`,
		};
	}

	async _executeSearchInContext(step, signal) {
		throwIfAborted(signal);
		const query = String(step.query || '').trim();
		if (!query) {
			throw makeTaskError('Missing search query', 'missing_query');
		}

		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : step.appHint || '';

		if (this.browserAdapter.isSupported(appName)) {
			const browserResult = this.browserAdapter.searchInPage({ appName, query });
			if (browserResult.ok) {
				await wait(250, signal);
				return {
					...browserResult,
					tier: 'native',
					domain: 'browser',
					resolverId: resolverIdForStep(step, appName),
					verificationMode: 'browser-adapter',
					successType: 'true_success',
				};
			}
		}

		const focusAttempts = [
			{ query: 'search', role: 'search field' },
			{ query: 'search', role: 'text field' },
			{ query: 'find', role: 'search field' },
		];
		for (const attempt of focusAttempts) {
			const focusResult = await runHelper({
				action: 'ax_focus',
				query: attempt.query,
				role: attempt.role,
				exact: false,
			});
			if (focusResult.ok === false) continue;
			const setResult = await runHelper({
				action: 'ax_set_value',
				query: attempt.query,
				role: attempt.role,
				exact: false,
				value: query,
			});
			if (setResult.ok !== false) {
				const submit = await runHelper({ action: 'press_key', key: 'return' });
				if (submit.ok === false) {
					throw makeTaskError(submit.result || `Search submit failed for "${query}"`, 'search_submit_failed');
				}
				const parsed = parseJsonResult(setResult.result, null);
				return {
					ok: true,
					tier: 'ax_dom',
					domain: 'browser',
					resolverId: resolverIdForStep(step, appName),
					verificationMode: 'accessibility',
					successType: 'true_success',
					resolutionMethod: 'accessibility',
					result: parsed?.message || `Searched for "${query}"`,
				};
			}
		}

		throw this._makePointerEligibleError(`Could not find a search field for "${query}" in ${appName || 'the current app'}`, 'search_field_missing');
	}

	async _executeClickSearchResult(step, signal) {
		throwIfAborted(signal);
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : step.appHint || '';
		const browserResult = this.browserAdapter.clickFirstSearchResult({
			appName,
			resultKind: step.resultKind || '',
		});
		if (!browserResult.ok) {
			throw this._makePointerEligibleError(browserResult.error, browserResult.code || 'click_result_failed');
		}
		await wait(250, signal);
		return {
			...browserResult,
			tier: 'native',
			domain: 'browser',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'browser-result',
			successType: 'true_success',
		};
	}

	async _executeMediaControl(step, signal) {
		throwIfAborted(signal);
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : step.appHint || '';
		if (this.browserAdapter.isSupported(appName)) {
			const result = this.browserAdapter.controlMedia({ appName, action: step.action || 'pause' });
			if (result.ok) {
				await wait(150, signal);
				return {
					...result,
					tier: 'native',
					domain: 'media',
					resolverId: resolverIdForStep(step, appName),
					verificationMode: 'browser-media',
					successType: 'true_success',
				};
			}
		}
		const keyResult = await runHelper({ action: 'press_key', key: 'space' });
		if (keyResult.ok === false) {
			throw makeTaskError(keyResult.result || `Could not ${step.action || 'pause'} media`, 'media_control_failed');
		}
		return {
			ok: true,
			tier: 'ax_dom',
			domain: 'media',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'media-key',
			successType: 'technical_success',
			resolutionMethod: 'input',
			result: `${step.action === 'play' ? 'Played' : 'Paused'} media in ${appName || 'current app'}`,
		};
	}

	async _executeEditorCommand(step, signal) {
		throwIfAborted(signal);
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const appName = frontmost.ok ? frontmost.name : step.appHint || '';
		const key = step.key || 'cmd+s';
		const result = await runHelper({ action: 'press_key', key });
		if (result.ok === false) {
			throw makeTaskError(result.result || `Could not run editor command ${step.action || key}`, 'editor_command_failed');
		}
		await wait(120, signal);
		return {
			ok: true,
			tier: 'native',
			domain: 'editor',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'editor-shortcut',
			successType: 'technical_success',
			resolutionMethod: 'input',
			result: `Ran editor command ${step.action || key} in ${appName || 'current app'}`,
		};
	}

	async _executeCleanupInstallArtifact(step, signal) {
		throwIfAborted(signal);
		const cleanup = await filesTools.cleanup_install_artifact({
			target: step.target || '',
			action: step.action || '',
			name: step.target || '',
		});
		if (cleanup.ok === false) {
			throw makeTaskError(cleanup.result || 'Installer cleanup failed', 'install_cleanup_failed');
		}
		await wait(120, signal);
		return {
			ok: true,
			tier: 'native',
			domain: 'finder',
			resolverId: 'finder.install_cleanup',
			verificationMode: cleanup.verificationMode || 'filesystem',
			successType: 'true_success',
			resolutionMethod: 'native',
			result: cleanup.result,
			cleanupAction: cleanup.cleanupAction || '',
			cleanupKind: cleanup.kind || '',
			path: cleanup.path || '',
		};
	}

	async _executeNavigateHistory(step, signal) {
		throwIfAborted(signal);
		const direction = step.direction === 'forward' ? 'forward' : 'back';
		const shortcut = direction === 'forward' ? 'cmd+rightbracket' : 'cmd+leftbracket';
		const frontmost = await this.worldState.getFrontmostApp({ force: true });
		const frontmostName = frontmost.ok ? frontmost.name : '';
		const appName = this.browserAdapter.isSupported(frontmostName) ? frontmostName : step.appHint || '';
		if (!this.browserAdapter.isSupported(appName)) {
			throw makeTaskError(`Browser history navigation is not supported in ${appName || 'the current app'}`, 'unsupported_app');
		}

		if (frontmostName !== appName) {
			const openResult = await runHelper({ action: 'open_app', name: appName });
			if (openResult.ok === false) {
				throw makeTaskError(openResult.result || `Could not activate ${appName}`, 'open_app_failed');
			}
			await wait(250, signal);
		}

		const beforeInfo = this.browserAdapter.getCurrentPageInfo({ appName });
		const result = await runHelper({ action: 'press_key', key: shortcut });
		if (result.ok === false) {
			throw makeTaskError(result.result || `Could not go ${direction} in ${appName}`, 'history_navigation_failed');
		}
		await wait(350, signal);

		const afterInfo = this.browserAdapter.getCurrentPageInfo({ appName });
		if (beforeInfo.ok && afterInfo.ok && !didBrowserPageChange(beforeInfo, afterInfo)) {
			throw makeTaskError(`Could not go ${direction} in ${appName} because no history entry was available`, 'history_navigation_failed');
		}

		return {
			ok: true,
			tier: 'native',
			domain: 'browser',
			resolverId: resolverIdForStep(step, appName),
			verificationMode: 'browser-history',
			successType: 'true_success',
			resolutionMethod: 'input',
			result: `Went ${direction} in ${appName}`,
			before: beforeInfo.href || '',
			after: afterInfo.href || '',
		};
	}

	async _executeScrollUntilVisible(step, signal) {
		throwIfAborted(signal);
		for (let attempt = 0; attempt < 6; attempt++) {
			if (step.selector?.text) {
				const axMatch = await this.worldState.findAccessibilityMatches(step.selector.text, { limit: 4 });
				if (axMatch.ok && axMatch.count > 0) {
					return {
						ok: true,
						tier: 'ax_dom',
						domain: 'general',
						resolverId: resolverIdForStep(step),
						verificationMode: 'accessibility',
						successType: 'true_success',
						resolutionMethod: 'accessibility',
						result: `Found "${step.selector.text}" after scrolling`,
					};
				}
			}

			const result = await runHelper({
				action: 'scroll',
				direction: step.direction || 'down',
				amount: 4,
			});
			if (result.ok === false) {
				throw makeTaskError(result.result || `Could not scroll ${step.direction}`, 'scroll_failed');
			}
			await wait(120, signal);
			this.worldState.invalidate();
		}

		throw this._makePointerEligibleError(`Could not find "${step.selector?.text || 'target'}" after scrolling`, 'scroll_target_missing');
	}

	_makePointerEligibleError(message, code = 'ui_task_failed', details = {}) {
		const err = makeTaskError(message, code, details);
		err.pointerFallbackEligible = true;
		err.pointerFallbackReason = message;
		return err;
	}

	_isTarsRescueEnabled() {
		const tars = this._getTarsConfig();
		return tars.enabled && Boolean(tars.endpoint) && Boolean(tars.apiKey);
	}

	async _attemptPrimaryTars({ taskId, plan, step, signal }) {
		if (!this._isTarsRescueEnabled() || !this.executionPolicy.supportsPrimaryTars(step)) {
			return { ok: false, error: makeTaskError('Primary TARS execution is unavailable', 'tars_unavailable') };
		}

		const captureResult = await this._screenCapture.capture();
		if (!captureResult?.ok || !captureResult.data || !captureResult.context?.captureId) {
			return { ok: false, error: makeTaskError(captureResult?.error || 'Screen capture failed before TARS execution', 'tars_capture_failed') };
		}

		const instruction = this._buildTarsInstruction({
			plan,
			step,
			error: null,
			attempt: 1,
		});
		const tarsResponse = await this._requestTarsAction({
			screenshotBase64: captureResult.data,
			instruction,
		});
		const normalized = this._validateTarsImagePoint(tarsResponse, captureResult.context);
		if (!normalized.ok) {
			return { ok: false, error: makeTaskError(normalized.error || 'TARS response could not be validated', normalized.code || 'tars_invalid_response') };
		}

		const point = this._mapRescuePoint(normalized.x, normalized.y, captureResult.context.captureId);
		if (!point) {
			return { ok: false, error: makeTaskError(`Missing capture mapping for ${captureResult.context.captureId}`, 'tars_mapping_missing') };
		}

		const clickResult = await this._performRescueClick(point);
		if (clickResult.ok === false) {
			return { ok: false, error: makeTaskError(clickResult.result || 'Primary TARS click failed', 'tars_click_failed') };
		}
		await wait(180, signal);

		const outcome = {
			ok: true,
			tier: 'tars_primary',
			domain: 'general',
			resolverId: `tars.${step.type || 'click'}`,
			verificationMode: 'checkpoint',
			successType: 'technical_success',
			resolutionMethod: 'tars_primary',
			result: `TARS clicked for ${stepLabel(step)}`,
			tarsRescue: {
				attempts: [{
					attempt: 1,
					status: 'clicked',
					instruction,
					captureId: captureResult.context.captureId,
					captureImageWidth: captureResult.context.imageWidth,
					captureImageHeight: captureResult.context.imageHeight,
					normalizedX: normalized.x,
					normalizedY: normalized.y,
					screenX: point.x,
					screenY: point.y,
					thought: normalized.thought || '',
					latencyMs: normalized.latencyMs,
					rawResponse: tarsResponse.raw || tarsResponse.rawText || null,
				}],
			},
		};

		try {
			if (step.checkpoint) {
				await this.verificationEngine.verifyCheckpoint(plan, step, outcome, signal);
			}
			outcome.successType = 'true_success';
			outcome.result = `Completed ${stepLabel(step)} via primary TARS execution`;
			return { ok: true, outcome };
		} catch (err) {
			return { ok: false, error: makeTaskError(err.message || 'Primary TARS verification failed', err.code || 'tars_verification_failed') };
		}
	}

	_buildTarsInstruction({ plan, step, error, attempt }) {
		const parts = [
			`Task goal: ${plan.goal}`,
			`Current UI step: ${stepLabel(step)}`,
		];
		if (step.selector?.text) {
			parts.push(`Target text: ${step.selector.text}`);
		}
		if (step.appHint || plan.appHint) {
			parts.push(`App context: ${step.appHint || plan.appHint}`);
		}
		if (plan.successSignal) {
			parts.push(`Success signal to preserve after click: ${plan.successSignal}`);
		}
		if (error?.message) {
			parts.push(`Previous semantic attempt failed because: ${error.message}`);
		}
		if (attempt > 1) {
			parts.push('Retry after the previous TARS click did not verify. Return a better click target within the screenshot image bounds.');
		}
		parts.push('Return the single best click target for this screenshot. Coordinates must be inside the screenshot image.');
		return parts.join('\n');
	}

	async _attemptTarsRescue({ taskId, plan, step, error, signal }) {
		if (!error?.pointerFallbackEligible) {
			return { ok: false, error };
		}
		if (!this._isTarsRescueEnabled()) {
			return { ok: false, error };
		}

		const attempts = [];
		const maxAttempts = 2;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			throwIfAborted(signal);
			const captureResult = await this._screenCapture.capture();
			if (!captureResult?.ok || !captureResult.data || !captureResult.context?.captureId) {
				attempts.push({
					attempt,
					status: 'capture_failed',
					error: captureResult?.error || 'Screen capture failed before TARS rescue',
				});
				break;
			}

			const instruction = this._buildTarsInstruction({ plan, step, error, attempt });
			const tarsResponse = await this._requestTarsAction({
				screenshotBase64: captureResult.data,
				instruction,
			});
			const normalized = this._validateTarsImagePoint(tarsResponse, captureResult.context);
			const attemptRecord = {
				attempt,
				instruction,
				captureId: captureResult.context.captureId,
				captureImageWidth: captureResult.context.imageWidth,
				captureImageHeight: captureResult.context.imageHeight,
				rawResponse: tarsResponse.raw || tarsResponse.rawText || null,
				status: normalized.ok ? 'validated' : 'rejected',
				rejectionCode: normalized.ok ? '' : normalized.code || '',
				rejectionError: normalized.ok ? '' : normalized.error || '',
			};

			if (!normalized.ok) {
				attempts.push(attemptRecord);
				log.warn('TARS', `Rejected TARS rescue response for task=${taskId} step=${step.type}: ${normalized.error}`);
				continue;
			}

			const point = this._mapRescuePoint(normalized.x, normalized.y, captureResult.context.captureId);
			if (!point) {
				attemptRecord.status = 'mapping_failed';
				attemptRecord.rejectionCode = 'tars_mapping_missing';
				attemptRecord.rejectionError = `Missing capture mapping for ${captureResult.context.captureId}`;
				attempts.push(attemptRecord);
				continue;
			}

			const clickResult = await this._performRescueClick(point);
			if (clickResult.ok === false) {
				attemptRecord.status = 'click_failed';
				attemptRecord.rejectionCode = 'tars_click_failed';
				attemptRecord.rejectionError = clickResult.result || 'TARS click failed';
				attempts.push(attemptRecord);
				continue;
			}
			await wait(180, signal);

			const outcome = {
				ok: true,
				tier: 'pointer_rescue',
				domain: 'general',
				resolverId: `tars.${step.type || 'click'}`,
				verificationMode: 'tars-rescue',
				successType: 'technical_success',
				resolutionMethod: 'tars_rescue',
				result: `TARS rescue clicked for ${stepLabel(step)}`,
				tarsRescue: {
					attempts: [...attempts, {
						...attemptRecord,
						status: 'clicked',
						normalizedX: normalized.x,
						normalizedY: normalized.y,
						screenX: point.x,
						screenY: point.y,
						thought: normalized.thought || '',
						latencyMs: normalized.latencyMs,
					}],
				},
			};

			try {
				if (step.checkpoint) {
					await this.verificationEngine.verifyCheckpoint(plan, step, outcome, signal);
				}
				outcome.successType = 'true_success';
				outcome.result = `Completed ${stepLabel(step)} via TARS rescue`;
				return { ok: true, outcome };
			} catch (verifyErr) {
				attemptRecord.status = 'verification_failed';
				attemptRecord.rejectionCode = verifyErr.code || 'tars_verification_failed';
				attemptRecord.rejectionError = verifyErr.message || 'TARS rescue verification failed';
				attemptRecord.normalizedX = normalized.x;
				attemptRecord.normalizedY = normalized.y;
				attemptRecord.screenX = point.x;
				attemptRecord.screenY = point.y;
				attemptRecord.thought = normalized.thought || '';
				attemptRecord.latencyMs = normalized.latencyMs;
				attempts.push(attemptRecord);
				log.warn('TARS', `TARS rescue verification failed for task=${taskId} step=${step.type}: ${attemptRecord.rejectionError}`);
			}
		}

		const reason = attempts.length
			? attempts[attempts.length - 1].rejectionError || error.message
			: error.message;
		const finalError = makeTaskError(reason, attempts.some((item) => item.rejectionCode === 'tars_verification_failed') ? 'tars_verification_failed' : 'tars_unavailable', {
			tarsRescue: { attempts },
		});
		return { ok: false, error: finalError };
	}
}

module.exports = {
	createPlanSignature,
	createTaskSignature,
	UITaskService,
};
