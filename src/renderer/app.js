// Entry point: init avatar + voice pipeline
import * as THREE from 'three';
import { createScene } from './avatar/scene.js';
import { loadAvatar } from './avatar/loader.js';
import { applyOverlays } from './avatar/overlays.js';
import { VoicePipeline } from './voice/pipeline.js';
import { error as logError } from './logger.js';

// Get avatar type from main process (async via preload)
const avatarConfig = window.getAvatarConfig ? await window.getAvatarConfig() : null;
const avatarType = avatarConfig?.current || 'tripo3d';

const { renderer, camera, scene } = createScene();
const { vrm, mixer, glowMaterials = [] } = await loadAvatar(scene, avatarType);

// Voice pipeline
const voice = new VoicePipeline();
window._voicePipeline = voice;
voice.start().catch(err => logError('Voice', 'Start error:', err));

// Click-to-reconnect: when disconnected, hovering over avatar makes window clickable
let mouseOverAvatar = false;
let hoverTimeout = null;

const muteBadge = document.getElementById('mute-badge');

window.addEventListener('mousemove', () => {
	// Always make clickable on hover (for mute toggle + reconnect)
	if (!mouseOverAvatar) {
		mouseOverAvatar = true;
		document.body.style.cursor = 'pointer';
		window.electronAPI.setIgnoreMouseEvents(false);
	}
	clearTimeout(hoverTimeout);
	hoverTimeout = setTimeout(() => {
		mouseOverAvatar = false;
		document.body.style.cursor = '';
		window.electronAPI.setIgnoreMouseEvents(true);
	}, 200);
});

window.addEventListener('click', () => {
	if (voice.needsReconnect) {
		mouseOverAvatar = false;
		document.body.style.cursor = '';
		window.electronAPI.setIgnoreMouseEvents(true);
		voice.reconnect();
		return;
	}
	// Toggle mute
	const muted = voice.toggleMute();
	muteBadge.classList.toggle('visible', muted);
});

// Render loop
const clock = new THREE.Clock();
let elapsedTime = 0;

// Set rotation based on avatar type
if (avatarType === 'original') {
	vrm.scene.rotation.y = Math.PI;
} else {
	const targetPosition = 12;
	const totalPositions = 16;
	const targetAngle = (targetPosition / totalPositions) * Math.PI * 2;
	vrm.scene.rotation.y = targetAngle;
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
		if (shader?.uniforms?.uGlowTime) {
			shader.uniforms.uGlowTime.value = elapsedTime;
		}
	}

	renderer.render(scene, camera);
}

animate();
