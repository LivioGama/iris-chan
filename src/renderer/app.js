// Entry point: init avatar + voice pipeline
import * as THREE from 'three';
import { createScene } from './avatar/scene.js';
import { loadAvatar } from './avatar/loader.js';
import { applyOverlays } from './avatar/overlays.js';
import { VoicePipeline } from './voice/pipeline.js';
import { error as logError } from './logger.js';

// Get avatar type from window (set by preload)
const avatarType = window.avatarConfig?.current || 'tripo3d';

const { renderer, camera, scene } = createScene();
const { vrm, mixer, glowMaterials = [] } = await loadAvatar(scene, avatarType);

// Voice pipeline
const voice = new VoicePipeline();
window._voicePipeline = voice;
voice.start().catch(err => logError('Voice', 'Start error:', err));

// Click-to-reconnect: when disconnected, hovering over avatar makes window clickable
let mouseOverAvatar = false;
let hoverTimeout = null;

window.addEventListener('mousemove', () => {
	if (!voice.needsReconnect) return;
	// Mouse is over the window (forwarded event) — make it clickable
	if (!mouseOverAvatar) {
		mouseOverAvatar = true;
		document.body.style.cursor = 'pointer';
		window.electronAPI.setIgnoreMouseEvents(false);
	}
	// Reset leave detection timer
	clearTimeout(hoverTimeout);
	hoverTimeout = setTimeout(() => {
		mouseOverAvatar = false;
		document.body.style.cursor = '';
		window.electronAPI.setIgnoreMouseEvents(true);
	}, 200);
});

window.addEventListener('click', () => {
	if (!voice.needsReconnect) return;
	mouseOverAvatar = false;
	document.body.style.cursor = '';
	window.electronAPI.setIgnoreMouseEvents(true);
	voice.reconnect();
});

// Render loop
const clock = new THREE.Clock();
let elapsedTime = 0;

// Keep figure rotation unchanged
const targetPosition = 12;
const totalPositions = 16;
const targetAngle = (targetPosition / totalPositions) * Math.PI * 2;
vrm.scene.rotation.y = targetAngle;
console.log(`✓ Avatar set to position ${targetPosition}`);

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
