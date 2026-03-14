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
const THREE = __importStar(require("three"));
const scene_js_1 = require("./avatar/scene.js");
const loader_js_1 = require("./avatar/loader.js");
const overlays_js_1 = require("./avatar/overlays.js");
const client_js_1 = require("./gemini/client.js");
const proactive_engine_js_1 = require("./behavior/proactive-engine.js");
const capture_js_1 = require("./voice/capture.js");
const playback_js_1 = require("./voice/playback.js");
const behavior_engine_js_1 = require("./voice/behavior-engine.js");
const voice_engine_js_1 = require("./voice/voice-engine.js");
const screen_capture_controller_js_1 = require("./voice/screen-capture-controller.js");
const claude_code_batcher_js_1 = require("./voice/claude-code-batcher.js");
const app_init_js_1 = require("./app-init.js");
const event_bus_web_js_1 = require("../shared/event-bus-web.js");
const logger_js_1 = require("./logger.js");
const performance_monitor_js_1 = require("./performance-monitor.js");
const BENCHMARKING_ENABLED = false;
const DEFAULT_PRESENTATION_MODEL_VOICE = 'Charon';
const DEFAULT_PRESENTATION_SPEECH_PROFILE = Object.freeze({
    playbackRate: 0.93,
    pitchSemitones: -2.6,
    lowShelfFrequencyHz: 170,
    lowShelfGainDb: 3.4,
    warmthFrequencyHz: 280,
    warmthGainDb: 2.6,
    warmthQ: 0.9,
    presenceFrequencyHz: 2100,
    presenceGainDb: 0.9,
    presenceQ: 0.7,
    highShelfFrequencyHz: 4800,
    highShelfGainDb: 0,
    outputGain: 1,
    compressorThresholdDb: -24,
    compressorKneeDb: 8,
    compressorRatio: 2.2,
    compressorAttackSeconds: 0.003,
    compressorReleaseSeconds: 0.2,
});
function normalizeVoiceConfigForDefaultSound(voice = null) {
    if (!voice || typeof voice !== 'object')
        return voice;
    const next = {
        ...voice,
        recentSeen: voice.recentSeen ? { ...voice.recentSeen } : voice.recentSeen,
        listeningGate: voice.listeningGate ? { ...voice.listeningGate } : voice.listeningGate,
        bargeIn: voice.bargeIn ? { ...voice.bargeIn } : voice.bargeIn,
    };
    const voiceName = String(next.modelVoiceName || '').trim();
    if (voiceName === DEFAULT_PRESENTATION_MODEL_VOICE) {
        delete next.modelVoiceName;
    }
    const profile = next.speechProfile && typeof next.speechProfile === 'object' ? next.speechProfile : null;
    if (profile) {
        const isDefaultProfile = Object.entries(DEFAULT_PRESENTATION_SPEECH_PROFILE).every(([key, value]) => profile[key] === value);
        if (isDefaultProfile) {
            delete next.speechProfile;
        }
        else {
            next.speechProfile = { ...profile };
        }
    }
    return next;
}
const runtimeSettings = await window.electronAPI.getSettings?.().catch(() => null);
const avatarConfig = runtimeSettings?.avatar || await window.getAvatarConfig?.().catch(() => null);
const avatarType = avatarConfig?.current || 'tripo3d';
const rawVoiceConfig = runtimeSettings?.voice || await window.electronAPI.getVoiceConfig?.().catch(() => null);
const voiceConfig = normalizeVoiceConfigForDefaultSound(rawVoiceConfig);
await (0, logger_js_1.initLogger)();
const performanceMonitor = BENCHMARKING_ENABLED
    ? (0, performance_monitor_js_1.createPerformanceMonitor)({
        getResourceMetrics: () => window.electronAPI.getBenchmarkProcessMetrics?.(),
        pingIpc: () => window.electronAPI.benchmarkRuntimeEventPing?.(),
    })
    : null;
performanceMonitor?.exposeGlobal(window);
performanceMonitor?.startBackgroundSampling();
const { renderer, camera, scene } = (0, scene_js_1.createScene)();
const scenePerformanceProbe = (0, scene_js_1.createScenePerformanceProbe)({ renderer, performanceMonitor });
const { vrm, mixer, glowMaterials = [] } = await (0, loader_js_1.loadAvatar)(scene, avatarType);
const gemini = new client_js_1.GeminiClient();
const capture = new capture_js_1.AudioCapture();
const playback = new playback_js_1.AudioPlayback();
const behavior = new behavior_engine_js_1.BehaviorEngine();
const screen = (0, screen_capture_controller_js_1.createScreenCaptureController)({ gemini });
const claudeCodeBatcher = (0, claude_code_batcher_js_1.createClaudeCodeBatcher)({ gemini });
// Adapter to match VoiceEngine's eventBus.emitEvent(type, payload, source) signature
const eventBus = {
    emitEvent(type, payload, source) {
        event_bus_web_js_1.eventBusWeb.emit(type, { ...payload, source });
    },
};
const voice = new voice_engine_js_1.VoiceEngine({
    gemini, capture, playback, behavior,
    eventBus, screen, claudeCodeBatcher, voiceConfig, performanceMonitor,
});
const proactive = new proactive_engine_js_1.ProactiveEngine({
    behavior,
    eventBus,
    voice,
    screen,
});
window._voicePipeline = voice;
await voice.start();
await proactive.start();
window.electronAPI.onSettingsChanged?.((nextSettings) => {
    const nextVoice = nextSettings?.voice;
    if (nextVoice) {
        voice.applyVoiceConfig?.(normalizeVoiceConfigForDefaultSound(nextVoice));
    }
});
const muteBadge = document.getElementById('mute-badge');
const raycaster = new THREE.Raycaster();
const mouseVec = new THREE.Vector2();
let mouseOverAvatar = false;
window.addEventListener('mousemove', (e) => {
    mouseVec.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseVec.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const isOverAvatar = raycaster.intersectObject(vrm.scene, true).length > 0;
    if (isOverAvatar !== mouseOverAvatar) {
        mouseOverAvatar = isOverAvatar;
        document.body.style.cursor = mouseOverAvatar ? 'pointer' : '';
        window.electronAPI.setIgnoreMouseEvents(!mouseOverAvatar);
    }
});
window.addEventListener('click', () => {
    if (voice.needsReconnect) {
        voice.reconnect();
        return;
    }
    const muted = voice.toggleMute();
    muteBadge.classList.toggle('visible', muted);
});
setupLogModeButton();
window.electronAPI.subscribeEvents?.();
window.electronAPI.onEvent?.((evt) => (0, app_init_js_1.onRuntimeEvent)(evt, { askedProgress: false }));
window.electronAPI.onTaskStream?.((data) => {
    const mappedType = data?.type === 'done' ? 'TASK_DONE' : 'TASK_MILESTONE';
    (0, app_init_js_1.onRuntimeEvent)({
        type: mappedType,
        timestamp: Date.now(),
        payload: { message: data?.message || data?.summary || data?.status || '' },
    }, { askedProgress: false });
});
window.addEventListener('beforeunload', () => {
    proactive.stop();
    performanceMonitor?.stopBackgroundSampling();
    window.electronAPI.unsubscribeEvents?.().catch(() => { });
});
const clock = new THREE.Clock();
let elapsedTime = 0;
if (avatarType === 'original') {
    vrm.scene.rotation.y = Math.PI;
}
else {
    vrm.scene.rotation.y = (12 / 16) * Math.PI * 2;
}
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    elapsedTime += delta;
    scenePerformanceProbe.recordFrame(delta);
    mixer.update(delta);
    (0, overlays_js_1.applyOverlays)(vrm, elapsedTime, () => voice.getSpeakingVolume());
    vrm.update(delta);
    for (const mat of glowMaterials) {
        const shader = mat.userData?._glowShader;
        if (shader?.uniforms?.uGlowTime)
            shader.uniforms.uGlowTime.value = elapsedTime;
    }
    renderer.render(scene, camera);
}
animate();
function setupLogModeButton() {
    const button = document.getElementById('log-mode-button');
    if (!button || !window.electronAPI?.updateLogSettings)
        return;
    const render = () => {
        const settings = (0, logger_js_1.getLogSettings)();
        const level = String(settings?.console?.level || 'info').toUpperCase();
        const persistOn = settings?.persist?.enabled !== false && settings?.persist?.level !== 'silent';
        button.textContent = `LOG ${level}`;
        button.dataset.persist = persistOn ? 'on' : 'off';
        button.title = `Console: ${level}. ${persistOn ? 'File logging on' : 'File logging off'}. Click to cycle console level, Shift-click to toggle file logging.`;
    };
    render();
    button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const settings = (0, logger_js_1.getLogSettings)();
        if (event.shiftKey) {
            const persistOn = settings?.persist?.enabled !== false && settings?.persist?.level !== 'silent';
            await window.electronAPI.updateLogSettings({
                persist: {
                    enabled: !persistOn,
                    level: !persistOn ? 'info' : 'silent',
                },
            });
            return;
        }
        const levels = ['info', 'warn', 'error', 'silent'];
        const currentIndex = levels.indexOf(settings?.console?.level || 'info');
        const nextLevel = levels[(currentIndex + 1 + levels.length) % levels.length];
        await window.electronAPI.updateLogSettings({
            console: {
                enabled: nextLevel !== 'silent',
                level: nextLevel,
            },
        });
    });
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    window.addEventListener('iris-log-settings-changed', render);
}
