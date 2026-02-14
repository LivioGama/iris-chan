// VRM + VRMA loading & optimization
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

export async function loadAvatar(scene) {
	const loader = new GLTFLoader();
	loader.crossOrigin = 'anonymous';
	loader.register((parser) => new VRMLoaderPlugin(parser));
	loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

	const [gltfVrm, gltfVrma] = await Promise.all([
		loader.loadAsync('../../assets/avatar.glb'),
		loader.loadAsync('../../assets/idle_loop.vrma'),
	]);

	const vrm = gltfVrm.userData.vrm;
	VRMUtils.removeUnnecessaryVertices(gltfVrm.scene);
	VRMUtils.combineSkeletons(gltfVrm.scene);
	VRMUtils.combineMorphs(vrm);
	vrm.scene.traverse((obj) => { obj.frustumCulled = false; });
	vrm.scene.rotation.y = Math.PI;

	for (let i = 0; i < 60; i++) vrm.update(1 / 60);
	scene.add(vrm.scene);

	const clip = createVRMAnimationClip(gltfVrma.userData.vrmAnimations[0], vrm);
	const mixer = new THREE.AnimationMixer(vrm.scene);
	mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();

	return { vrm, mixer };
}
