// Three.js scene, camera, renderer, lighting, resize handler, render loop
import * as THREE from 'three';

function lerp(current, target, factor) {
	return current + (target - current) * factor;
}

export function createAvatarLightRig() {
	const rig = new THREE.Group();
	rig.name = 'iris-living-light-rig';

	const coolSpot = new THREE.SpotLight(0x84ddff, 0.9, 7.5, 0.58, 0.85, 1.35);
	coolSpot.position.set(-0.9, 1.75, -1.6);
	coolSpot.castShadow = false;

	const coolTarget = new THREE.Object3D();
	coolTarget.position.set(0.08, 1.12, 0.45);
	coolSpot.target = coolTarget;

	const warmSpot = new THREE.SpotLight(0xffd2a6, 0.42, 6.8, 0.52, 0.92, 1.15);
	warmSpot.position.set(0.75, 1.45, -1.25);
	warmSpot.castShadow = false;

	const warmTarget = new THREE.Object3D();
	warmTarget.position.set(0.1, 1.02, 0.38);
	warmSpot.target = warmTarget;

	rig.add(coolSpot);
	rig.add(coolTarget);
	rig.add(warmSpot);
	rig.add(warmTarget);

	const state = {
		attachedRoot: null,
		coolIntensity: coolSpot.intensity,
		warmIntensity: warmSpot.intensity,
	};

	const base = {
		coolPos: coolSpot.position.clone(),
		warmPos: warmSpot.position.clone(),
		coolTarget: coolTarget.position.clone(),
		warmTarget: warmTarget.position.clone(),
	};

	return {
		group: rig,
		coolSpot,
		warmSpot,
		attach(root) {
			if (!root || state.attachedRoot === root) return;
			if (rig.parent) rig.parent.remove(rig);
			root.add(rig);
			state.attachedRoot = root;
		},
		update({ elapsedTime = 0, thinking = false, speaking = false, speakingVolume = 0 } = {}) {
			const safeVolume = Math.min(1, Math.max(0, speakingVolume * 2.8));
			const pulseWave = 0.5 + 0.5 * Math.sin(elapsedTime * 0.78 + Math.sin(elapsedTime * 0.19) * 0.35);
			const pulse = pulseWave * 2 - 1;

			const baseCool = thinking ? 2.1 : speaking ? 0.7 : 1.15;
			const baseWarm = thinking ? 0.92 : speaking ? 0.3 : 0.48;
			const pulseAmp = thinking ? 0.42 : speaking ? 0.08 : 0.18;
			const speakingDamp = speaking ? safeVolume * 0.18 : 0;

			const targetCool = Math.max(0.35, baseCool + pulse * pulseAmp - speakingDamp);
			const targetWarm = Math.max(0.12, baseWarm + pulse * pulseAmp * 0.45 - speakingDamp * 0.3);

			state.coolIntensity = lerp(state.coolIntensity, targetCool, 0.08);
			state.warmIntensity = lerp(state.warmIntensity, targetWarm, 0.08);
			coolSpot.intensity = state.coolIntensity;
			warmSpot.intensity = state.warmIntensity;

			const drift = thinking ? 1 : speaking ? 0.35 : 0.6;
			coolSpot.position.set(
				base.coolPos.x + Math.sin(elapsedTime * 0.31) * 0.05 * drift,
				base.coolPos.y + Math.sin(elapsedTime * 0.47 + 0.5) * 0.04 * drift,
				base.coolPos.z + Math.cos(elapsedTime * 0.28) * 0.03 * drift
			);
			warmSpot.position.set(
				base.warmPos.x + Math.cos(elapsedTime * 0.27 + 1.2) * 0.04 * drift,
				base.warmPos.y + Math.sin(elapsedTime * 0.36 + 1.1) * 0.03 * drift,
				base.warmPos.z + Math.sin(elapsedTime * 0.24 + 0.4) * 0.02 * drift
			);
			coolTarget.position.set(
				base.coolTarget.x,
				base.coolTarget.y + Math.sin(elapsedTime * 0.42 + 0.2) * 0.025 * drift,
				base.coolTarget.z + Math.cos(elapsedTime * 0.34 + 0.4) * 0.02 * drift
			);
			warmTarget.position.set(
				base.warmTarget.x,
				base.warmTarget.y + Math.cos(elapsedTime * 0.39 + 1.5) * 0.02 * drift,
				base.warmTarget.z + Math.sin(elapsedTime * 0.29 + 0.8) * 0.018 * drift
			);
			coolTarget.updateMatrixWorld();
			warmTarget.updateMatrixWorld();
		},
	};
}

export function createScene() {
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: 'high-performance',
		alpha: true,
	});
	renderer.setClearColor(0x000000, 0);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild(renderer.domElement);

	const camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 20.0);
	camera.position.set(0.0, 1.05, 2.4);
	camera.lookAt(0.0, 1.05, 0.0);
	// Offset view so avatar renders on the left, leaving right side for chat bubbles
	const w = window.innerWidth;
	const h = window.innerHeight;
	camera.setViewOffset(w, h, Math.round(w * 0.22), 0, w, h);

	const scene = new THREE.Scene();

	const ambientLight = new THREE.AmbientLight(0xf3f7ff, 0.48);
	scene.add(ambientLight);

	const keyLight = new THREE.DirectionalLight(0xfff7ea, 1.35);
	keyLight.position.set(0.9, 1.35, 1.6).normalize();
	scene.add(keyLight);

	const fillLight = new THREE.DirectionalLight(0xc7d7ff, 0.42);
	fillLight.position.set(-0.7, 0.85, 1.35).normalize();
	scene.add(fillLight);

	const avatarLightRig = createAvatarLightRig();

	window.addEventListener('resize', () => {
		const rw = window.innerWidth;
		const rh = window.innerHeight;
		camera.aspect = rw / rh;
		camera.setViewOffset(rw, rh, Math.round(rw * 0.22), 0, rw, rh);
		camera.updateProjectionMatrix();
		renderer.setSize(rw, rh);
	});

	return { renderer, camera, scene, avatarLightRig };
}

export function createScenePerformanceProbe({ renderer, performanceMonitor }) {
	return {
		recordFrame(deltaSeconds) {
			if (!performanceMonitor || !renderer) return;
			const canvas = renderer.domElement;
			const rect = typeof canvas?.getBoundingClientRect === 'function'
				? canvas.getBoundingClientRect()
				: { width: 0, height: 0 };
			const style = canvas ? window.getComputedStyle(canvas) : null;
			const avatarVisible = !!canvas
				&& canvas.isConnected
				&& rect.width > 0
				&& rect.height > 0
				&& style?.display !== 'none'
				&& style?.visibility !== 'hidden';
			performanceMonitor.recordFrame({
				deltaMs: deltaSeconds * 1000,
				avatarVisible,
				documentHidden: document.hidden,
			});
		},
	};
}
