// Entry point: init avatar + voice pipeline
import * as THREE from 'three';
import { createScene } from './avatar/scene.js';
import { loadAvatar } from './avatar/loader.js';
import { applyOverlays } from './avatar/overlays.js';
import { VoicePipeline } from './voice/pipeline.js';

const { renderer, camera, scene } = createScene();
const { vrm, mixer } = await loadAvatar(scene);

// Voice pipeline
const voice = new VoicePipeline();
window._voicePipeline = voice;
voice.start().catch(err => console.error('[Voice] Start error:', err));

// Render loop
const clock = new THREE.Clock();
let elapsedTime = 0;

function animate() {
	requestAnimationFrame(animate);
	const delta = clock.getDelta();
	elapsedTime += delta;

	mixer.update(delta);
	applyOverlays(vrm, elapsedTime, () => voice.getSpeakingVolume());
	vrm.update(delta);

	renderer.render(scene, camera);
}

animate();
