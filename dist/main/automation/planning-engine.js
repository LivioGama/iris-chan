"use strict";
const { normalizeSignatureText, makeTaskError } = require('./ui-task-service-utils');
const { createExecutionPlan } = require('./planner');
function createPlanSignature(plan = {}) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    return JSON.stringify({
        appHint: normalizeSignatureText(plan.appHint || ''),
        steps: steps.map((step) => ({
            type: step.type || '',
            appName: normalizeSignatureText(step.appName || step.appHint || ''),
            url: step.url || '',
            direction: normalizeSignatureText(step.direction || ''),
            query: normalizeSignatureText(step.query || ''),
            value: normalizeSignatureText(step.value || ''),
            resultKind: normalizeSignatureText(step.resultKind || ''),
            position: Number(step.position || 0),
            selectorText: normalizeSignatureText(step.selector?.text || ''),
            selectorRole: normalizeSignatureText(step.selector?.role || ''),
        })),
    });
}
function createTaskSignature({ goal = '', appHint = '', successSignal = '' } = {}) {
    return JSON.stringify({
        goal: normalizeSignatureText(goal),
        appHint: normalizeSignatureText(appHint),
        successSignal: normalizeSignatureText(successSignal),
    });
}
class PlanningEngine {
    constructor(uiTaskService) {
        this.uiTaskService = uiTaskService;
    }
    async getRouteAppHint() {
        const frontmost = await this.uiTaskService.worldState.getFrontmostApp({ force: true });
        return frontmost.ok ? String(frontmost.name || '').trim() : '';
    }
    createPlan({ goal, appHint, successSignal }) {
        return createExecutionPlan({ goal, appHint, successSignal });
    }
    createPlanSignature(plan) {
        return createPlanSignature(plan);
    }
    createTaskSignature(params) {
        return createTaskSignature(params);
    }
}
module.exports = {
    PlanningEngine,
    createPlanSignature,
    createTaskSignature,
};
