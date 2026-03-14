// VRM + VRMA loading & optimization
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

// Load meshopt decoder for Tripo3D models (optional)
async function initMeshoptDecoder(loader) {
	// Meshopt decoder is optional - only needed for compressed models
}

export async function loadAvatar(scene, avatarType = 'tripo3d') {
	const loader = new GLTFLoader();
	loader.crossOrigin = 'anonymous';

	// Initialize meshopt decoder for compressed models
	await initMeshoptDecoder(loader);

	loader.register((parser) => new VRMLoaderPlugin(parser));
	loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

	// Select avatar file based on type
	let avatarFile = '../../assets/avatar.glb';
	if (avatarType === 'original') {
		avatarFile = '../../assets/girl.glb';
	}

	// Load avatar GLB
	const gltf = await loader.loadAsync(avatarFile);

	// Check if it's a VRM or regular glTF/GLB
	const isVRM = gltf.userData.vrm;

	if (isVRM) {
		// VRM format with animations
		const vrm = gltf.userData.vrm;
		VRMUtils.removeUnnecessaryVertices(gltf.scene);
		VRMUtils.combineSkeletons(gltf.scene);
		VRMUtils.combineMorphs(vrm);
		vrm.scene.traverse((obj) => { obj.frustumCulled = false; });
		vrm.scene.rotation.y = Math.PI;

		for (let i = 0; i < 60; i++) vrm.update(1 / 60);
		scene.add(vrm.scene);

		// Try to load animation
		const mixer = new THREE.AnimationMixer(vrm.scene);
		try {
			const gltfVrma = await loader.loadAsync('../../assets/idle_loop.vrma');
			const clip = createVRMAnimationClip(gltfVrma.userData.vrmAnimations[0], vrm);
			mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();
		} catch (e) {
			console.warn('Animation not found, using model without animation');
		}

		return { vrm, mixer };
	}

	// Regular glTF/GLB format (e.g., from Tripo3D)
	const model = gltf.scene;

	// Try to load and apply textures
	const textureLoader = new THREE.TextureLoader();
	const textureFiles = [
		'flipy_853a081f-498e-4313-8754-d65dea83bae1.jpg',
		'flipy_b2933f39-01fa-4c5d-b9ef-ff27136669ed.jpg',
		'flipy_bc8f41a8-75b7-4ed4-bdea-f7768d2cdf91.jpg'
	];

	for (const file of textureFiles) {
		try {
			await textureLoader.loadAsync(`../../assets/${file}`);
			console.log('✓ Loaded texture:', file);
		} catch (e) {
			console.warn('Could not load texture:', file);
		}
	}

	model.traverse((obj) => {
		obj.frustumCulled = false;
		if (obj.isMesh) {
			obj.castShadow = true;
			obj.receiveShadow = true;
			if (obj.material) obj.material.needsUpdate = true;
		}
	});

	// Keep figure orientation and placement unchanged.
	model.rotation.y = Math.PI;
	model.position.y = 0.85;
	model.position.x = 0.15;
	model.scale.multiplyScalar(0.8);

	scene.add(model);
	const mixer = new THREE.AnimationMixer(model);
	if (gltf.animations && gltf.animations.length > 0) {
		const action = mixer.clipAction(gltf.animations[0]);
		action.setLoop(THREE.LoopRepeat).play();
	}

	return { vrm: { scene: model, update: () => {} }, mixer };
}
