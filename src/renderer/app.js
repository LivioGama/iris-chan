import * as THREE from 'three';
import { createScene, createScenePerformanceProbe } from './avatar/scene.js';
import { loadAvatar } from './avatar/loader.js';
import { applyOverlays } from './avatar/overlays.js';
import { GeminiClient } from './gemini/client.js';
import { ProactiveEngine } from './behavior/proactive-engine.js';
import { AudioCapture } from './voice/capture.js';
import { AudioPlayback } from './voice/playback.js';
import { BehaviorEngine } from './voice/behavior-engine.js';
import { VoiceEngine } from './voice/voice-engine.js';
import { createScreenCaptureController } from './voice/screen-capture-controller.js';
import { createClaudeCodeBatcher } from './voice/claude-code-batcher.js';
import { onRuntimeEvent } from './app-init.js';
import { eventBusWeb } from '../shared/event-bus-web.js';
import { initLogger, getLogSettings } from './logger.js';
import { createPerformanceMonitor } from './performance-monitor.js';

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
	if (!voice || typeof voice !== 'object') return voice;
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
		const isDefaultProfile = Object.entries(DEFAULT_PRESENTATION_SPEECH_PROFILE).every(
			([key, value]) => profile[key] === value
		);
		if (isDefaultProfile) {
			delete next.speechProfile;
		} else {
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
await initLogger();

const performanceMonitor = BENCHMARKING_ENABLED
	? createPerformanceMonitor({
		getResourceMetrics: () => window.electronAPI.getBenchmarkProcessMetrics?.(),
		pingIpc: () => window.electronAPI.benchmarkRuntimeEventPing?.(),
	})
	: null;
performanceMonitor?.exposeGlobal(window);
performanceMonitor?.startBackgroundSampling();

const { renderer, camera, scene } = createScene();
const scenePerformanceProbe = createScenePerformanceProbe({ renderer, performanceMonitor });
const { vrm, mixer, glowMaterials = [] } = await loadAvatar(scene, avatarType);

const gemini = new GeminiClient();
const capture = new AudioCapture();
const playback = new AudioPlayback();
const behavior = new BehaviorEngine();
const screen = createScreenCaptureController({ gemini });
const claudeCodeBatcher = createClaudeCodeBatcher({ gemini });

// Adapter to match VoiceEngine's eventBus.emitEvent(type, payload, source) signature
const eventBus = {
	emitEvent(type, payload, source) {
		eventBusWeb.emit(type, { ...payload, source });
	},
};

const voice = new VoiceEngine({
	gemini, capture, playback, behavior,
	eventBus, screen, claudeCodeBatcher, voiceConfig, performanceMonitor,
});
const proactive = new ProactiveEngine({
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
window.electronAPI.onEvent?.((evt) => onRuntimeEvent(evt, { askedProgress: false }));
window.electronAPI.onTaskStream?.((data) => {
	const mappedType = data?.type === 'done' ? 'TASK_DONE' : 'TASK_MILESTONE';
	onRuntimeEvent({
		type: mappedType,
		timestamp: Date.now(),
		payload: { message: data?.message || data?.summary || data?.status || '' },
	}, { askedProgress: false });
});
window.addEventListener('beforeunload', () => {
	proactive.stop();
	performanceMonitor?.stopBackgroundSampling();
	window.electronAPI.unsubscribeEvents?.().catch(() => {});
});

const clock = new THREE.Clock();
let elapsedTime = 0;

if (avatarType === 'original') {
	vrm.scene.rotation.y = Math.PI;
} else {
	vrm.scene.rotation.y = (12 / 16) * Math.PI * 2;
}

function animate() {
	requestAnimationFrame(animate);
	const delta = clock.getDelta();
	elapsedTime += delta;
	scenePerformanceProbe.recordFrame(delta);
	mixer.update(delta);
	applyOverlays(vrm, elapsedTime, () => voice.getSpeakingVolume());
	vrm.update(delta);
	for (const mat of glowMaterials) {
		const shader = mat.userData?._glowShader;
		if (shader?.uniforms?.uGlowTime) shader.uniforms.uGlowTime.value = elapsedTime;
	}
	renderer.render(scene, camera);
}
animate();

function setupLogModeButton() {
	const button = document.getElementById('log-mode-button');
	if (!button || !window.electronAPI?.updateLogSettings) return;
	const render = () => {
		const settings = getLogSettings();
		const level = String(settings?.console?.level || 'info').toUpperCase();
		const persistOn = settings?.persist?.enabled !== false && settings?.persist?.level !== 'silent';
		button.textContent = `LOG ${level}`;
		button.dataset.persist = persistOn ? 'on' : 'off';
		button.title = `Console: ${level}. ${persistOn ? 'File logging on' : 'File logging off'}. Click to cycle console level, Shift-click to toggle file logging.`;
	};
	render();
	button.addEventListener('click', async (event) => {
		event.stopPropagation();
		const settings = getLogSettings();
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
