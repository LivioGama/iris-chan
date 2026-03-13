import * as THREE from 'three';
import { createScene } from './avatar/scene.js';
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
import { renderToolsSkillsPanel, anchorPanelToAvatar } from './ui/tools-skills-panel.js';
import { onRuntimeEvent } from './app-init.js';
import { eventBusWeb } from '../shared/event-bus-web.js';
import { initLogger, getLogSettings } from './logger.js';

const avatarConfig = window.getAvatarConfig ? await window.getAvatarConfig() : null;
const avatarType = avatarConfig?.current || 'tripo3d';
const voiceConfig = await window.electronAPI.getVoiceConfig?.().catch(() => null);
await initLogger();

const { renderer, camera, scene } = createScene();
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
	eventBus, screen, claudeCodeBatcher, voiceConfig,
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

const tools = (await window.electronAPI.getSkillDeclarations()?.then((decl) => (decl || []).map((d) => d.name)).catch(() => [])) || [];
const skills = (await window.electronAPI.getSkillCatalog()?.then((items) => (items || []).map((s) => s.name)).catch(() => [])) || [];
renderToolsSkillsPanel({ tools, skills });
setupLogModeButton();

function updateSidePanelsAnchor() {
	const canvasRect = renderer.domElement.getBoundingClientRect();
	anchorPanelToAvatar({
		right: Math.round(canvasRect.left + Math.min(260, canvasRect.width - 40)),
		top: Math.round(canvasRect.top + 10),
	});
}

updateSidePanelsAnchor();
window.addEventListener('resize', updateSidePanelsAnchor);

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
