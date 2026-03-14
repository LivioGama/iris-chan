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
function createClaudeCodingAdapter() {
    return {
        name: 'claude',
        async run({ prompt, cwd, env = process.env, signal, onLog }) {
            onLog?.('[status] Importing Claude Code SDK...');
            const { query } = await Promise.resolve().then(() => __importStar(require('@anthropic-ai/claude-agent-sdk')));
            onLog?.('[status] SDK ready, starting execution...');
            const cleanEnv = { ...env };
            for (const key of Object.keys(cleanEnv)) {
                if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
                    delete cleanEnv[key];
                }
            }
            for await (const msg of query({
                prompt,
                options: {
                    cwd,
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch'],
                    env: cleanEnv,
                    stderr: (data) => {
                        onLog?.(`[stderr] ${String(data || '').trim()}`);
                    },
                    signal,
                },
            })) {
                if (msg.type === 'assistant') {
                    for (const block of msg.message?.content || []) {
                        if (block.type === 'text' && block.text)
                            onLog?.(block.text);
                        else if (block.type === 'tool_use')
                            onLog?.(`[tool: ${block.name}]`);
                    }
                }
                else if (msg.type === 'tool_use_summary') {
                    onLog?.(msg.summary);
                }
                else if (msg.type === 'result') {
                    const status = msg.subtype === 'success' ? 'COMPLETED' : 'FAILED';
                    const summary = msg.subtype === 'success'
                        ? (msg.result || '')
                        : (msg.errors?.join(', ') || 'Unknown error');
                    return { status, summary };
                }
            }
            return { status: 'COMPLETED', summary: '' };
        },
    };
}
module.exports = { createClaudeCodingAdapter };
