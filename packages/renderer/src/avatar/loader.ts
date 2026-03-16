import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface AvatarModel {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  vrm: unknown | null;
}

export const loadAvatar = async (
  scene: THREE.Scene,
  modelType: 'tripo3d' | 'original' = 'tripo3d',
): Promise<AvatarModel> => {
  const loader = new GLTFLoader();

  // Try VRM plugins if available
  try {
    const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');
    const { VRMAnimationLoaderPlugin } = await import(
      '@pixiv/three-vrm-animation'
    );
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as any));
    loader.register(
      (parser: unknown) => new VRMAnimationLoaderPlugin(parser as any),
    );
  } catch {
    // VRM plugins not available — loading as regular glTF
  }

  const modelPath =
    modelType === 'tripo3d'
      ? '../../assets/tripo3d/model.glb'
      : '../../assets/original/model.vrm';

  return new Promise((resolve, reject) => {
    loader.load(
      modelPath,
      (gltf) => {
        const vrm = (gltf as any).userData?.vrm ?? null;
        let root: THREE.Group;
        let mixer: THREE.AnimationMixer | null = null;

        if (vrm) {
          // VRM model
          root = vrm.scene;
          try {
            const { VRMUtils } = require('@pixiv/three-vrm');
            VRMUtils.removeUnnecessaryVertices(root);
            VRMUtils.combineSkeletons(root);
            VRMUtils.combineMorphs(root);
          } catch {}
          mixer = new THREE.AnimationMixer(root);
        } else {
          // Regular glTF (tripo3d)
          root = gltf.scene;
          root.rotation.y = Math.PI;
          root.position.set(0.15, 0.85, 0);
          root.scale.setScalar(0.8);

          if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(root);
            const clip = gltf.animations[0];
            mixer.clipAction(clip).play();
          }
        }

        scene.add(root);
        resolve({ root, mixer, vrm });
      },
      undefined,
      reject,
    );
  });
};
