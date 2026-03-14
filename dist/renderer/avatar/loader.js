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
exports.loadAvatar = loadAvatar;
// VRM + VRMA loading & optimization
const THREE = __importStar(require("three"));
const GLTFLoader_js_1 = require("three/addons/loaders/GLTFLoader.js");
const three_vrm_1 = require("@pixiv/three-vrm");
const three_vrm_animation_1 = require("@pixiv/three-vrm-animation");
// Load meshopt decoder for Tripo3D models (optional)
async function initMeshoptDecoder(loader) {
    // Meshopt decoder is optional - only needed for compressed models
}
function getGlobeFit(parent, vrmInstance) {
    const fallback = { center: new THREE.Vector3(0.0, 0.9, 0.0), radius: 0.12 };
    if (!parent)
        return fallback;
    // If we have a VRM instance, try to get the head bone position directly
    if (vrmInstance?.humanoid) {
        try {
            const headNode = vrmInstance.humanoid.getNormalizedBoneNode('head');
            if (headNode) {
                // Get world position of head bone
                const worldPos = new THREE.Vector3();
                headNode.getWorldPosition(worldPos);
                // Transform to parent space
                parent.updateMatrixWorld(true);
                const invParentWorld = new THREE.Matrix4().copy(parent.matrixWorld).invert();
                worldPos.applyMatrix4(invParentWorld);
                return { center: worldPos, radius: 0.12 };
            }
        }
        catch (e) {
            console.warn('Could not get head bone position from VRM:', e);
        }
    }
    // Try to find the head bone or mesh first
    let headObject = null;
    parent.traverse((obj) => {
        // Look for a mesh that might be the head
        if (obj?.isMesh && obj.geometry) {
            // Check if this mesh is likely to be the head based on position and name
            const name = obj.name?.toLowerCase() || '';
            if (name.includes('head') || name.includes('skull') || name.includes('face')) {
                headObject = obj;
                return;
            }
            // If no named head object, look for object at approximate head height
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            if (worldPos.y > 0.7 && worldPos.y < 1.2) {
                // Likely in head region
                if (!headObject || worldPos.y > headObject.getWorldPosition(new THREE.Vector3()).y) {
                    headObject = obj;
                }
            }
        }
    });
    // If we found a head object, compute its bounding sphere
    if (headObject) {
        const geo = headObject.geometry;
        if (!geo.boundingSphere)
            geo.computeBoundingSphere();
        if (geo.boundingSphere) {
            const center = geo.boundingSphere.center.clone();
            headObject.updateMatrixWorld(true);
            center.applyMatrix4(headObject.matrixWorld);
            // Transform to parent space
            parent.updateMatrixWorld(true);
            const invParentWorld = new THREE.Matrix4().copy(parent.matrixWorld).invert();
            center.applyMatrix4(invParentWorld);
            return { center, radius: geo.boundingSphere.radius };
        }
    }
    // Fall back to original algorithm if head detection fails
    parent.updateMatrixWorld(true);
    const invParentWorld = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    let best = null;
    parent.traverse((obj) => {
        if (!obj?.isMesh || !obj.geometry)
            return;
        const geo = obj.geometry;
        if (!geo.boundingSphere)
            geo.computeBoundingSphere();
        if (!geo.boundingSphere)
            return;
        obj.updateMatrixWorld(true);
        const toParent = new THREE.Matrix4().multiplyMatrices(invParentWorld, obj.matrixWorld);
        const center = geo.boundingSphere.center.clone().applyMatrix4(toParent);
        const colX = new THREE.Vector3().setFromMatrixColumn(toParent, 0);
        const colY = new THREE.Vector3().setFromMatrixColumn(toParent, 1);
        const colZ = new THREE.Vector3().setFromMatrixColumn(toParent, 2);
        const rx = geo.boundingSphere.radius * colX.length();
        const ry = geo.boundingSphere.radius * colY.length();
        const rz = geo.boundingSphere.radius * colZ.length();
        const rMax = Math.max(rx, ry, rz);
        const rMin = Math.min(rx, ry, rz);
        if (rMax <= 0.001)
            return;
        const isotropy = rMin / rMax;
        const avgRadius = (rx + ry + rz) / 3.0;
        const distToCenter = center.length();
        const distPenalty = Math.min(1.5, distToCenter * 2.2);
        const score = isotropy * 2.0 + avgRadius * 3.5 - distPenalty;
        if (avgRadius < 0.06 || avgRadius > 0.2)
            return;
        if (isotropy < 0.72)
            return;
        if (!best || score > best.score) {
            best = { center, radius: avgRadius, score };
        }
    });
    return best ? { center: best.center, radius: best.radius } : fallback;
}
function addGlobeOverlay(parent, vrmInstance) {
    if (!parent)
        return [];
    const fit = getGlobeFit(parent, vrmInstance);
    const center = fit.center;
    const radius = fit.radius;
    const overlay = new THREE.Group();
    overlay.position.copy(center);
    const shellMat = new THREE.ShaderMaterial({
        uniforms: {
            uGlowTime: { value: 0.0 },
            uWarm: { value: new THREE.Color(0xffd27f) },
            uCool: { value: new THREE.Color(0x8bd7ff) },
        },
        vertexShader: `
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
				vNormalVS = normalize(normalMatrix * normal);
				vViewDirVS = normalize(-mvPos.xyz);
				gl_Position = projectionMatrix * mvPos;
			}
		`,
        fragmentShader: `
			uniform float uGlowTime;
			uniform vec3 uWarm;
			uniform vec3 uCool;
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				vec3 n = normalize(vNormalVS);
				vec3 v = normalize(vViewDirVS);
				float ndv = clamp(dot(n, v), 0.0, 1.0);
				float rim = pow(1.0 - ndv, 2.0);
				float core = pow(ndv, 5.5);
				vec3 fakeLight = normalize(vec3(-0.35, 0.65, 1.0));
				float spec = pow(max(dot(n, fakeLight), 0.0), 12.0);
				float pulse = 0.96 + 0.04 * sin(uGlowTime * 1.25);
				float alpha = (rim * 0.28 + core * 0.16 + spec * 0.30) * pulse;
				vec3 color = mix(uCool, uWarm, clamp(core + spec * 0.8, 0.0, 1.0));
				gl_FragColor = vec4(color, alpha);
			}
		`,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });
    shellMat.userData._glowShader = { uniforms: shellMat.uniforms };
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.01, 96, 96), shellMat);
    shell.renderOrder = 200;
    overlay.add(shell);
    const auraMat = new THREE.ShaderMaterial({
        uniforms: {
            uGlowTime: { value: 0.0 },
            uAura: { value: new THREE.Color(0xffc988) },
        },
        vertexShader: `
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
				vNormalVS = normalize(normalMatrix * normal);
				vViewDirVS = normalize(-mvPos.xyz);
				gl_Position = projectionMatrix * mvPos;
			}
		`,
        fragmentShader: `
			uniform float uGlowTime;
			uniform vec3 uAura;
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				float ndv = clamp(dot(normalize(vNormalVS), normalize(vViewDirVS)), 0.0, 1.0);
				float rim = pow(1.0 - ndv, 2.6);
				float pulse = 0.92 + 0.08 * sin(uGlowTime * 0.9 + 0.4);
				float alpha = rim * 0.18 * pulse;
				gl_FragColor = vec4(uAura, alpha);
			}
		`,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.BackSide,
    });
    auraMat.userData._glowShader = { uniforms: auraMat.uniforms };
    const aura = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.09, 96, 96), auraMat);
    aura.renderOrder = 201;
    overlay.add(aura);
    const rimMat = new THREE.ShaderMaterial({
        uniforms: {
            uGlowTime: { value: 0.0 },
            uRim: { value: new THREE.Color(0xcdefff) },
        },
        vertexShader: `
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
				vNormalVS = normalize(normalMatrix * normal);
				vViewDirVS = normalize(-mvPos.xyz);
				gl_Position = projectionMatrix * mvPos;
			}
		`,
        fragmentShader: `
			uniform float uGlowTime;
			uniform vec3 uRim;
			varying vec3 vNormalVS;
			varying vec3 vViewDirVS;
			void main() {
				float ndv = clamp(dot(normalize(vNormalVS), normalize(vViewDirVS)), 0.0, 1.0);
				float rim = pow(1.0 - ndv, 1.3);
				float pulse = 0.9 + 0.1 * sin(uGlowTime * 1.35 + 0.9);
				float alpha = rim * 0.5 * pulse;
				gl_FragColor = vec4(uRim, alpha);
			}
		`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    rimMat.userData._glowShader = { uniforms: rimMat.uniforms };
    const rim = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.14, 96, 96), rimMat);
    rim.renderOrder = 202;
    overlay.add(rim);
    parent.add(overlay);
    console.log(`✓ Globe overlay added. Center=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}), radius=${radius.toFixed(3)}`);
    return [shellMat, auraMat, rimMat];
}
async function loadAvatar(scene, avatarType = 'tripo3d') {
    const loader = new GLTFLoader_js_1.GLTFLoader();
    loader.crossOrigin = 'anonymous';
    // Initialize meshopt decoder for compressed models
    await initMeshoptDecoder(loader);
    loader.register((parser) => new three_vrm_1.VRMLoaderPlugin(parser));
    loader.register((parser) => new three_vrm_animation_1.VRMAnimationLoaderPlugin(parser));
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
        three_vrm_1.VRMUtils.removeUnnecessaryVertices(gltf.scene);
        three_vrm_1.VRMUtils.combineSkeletons(gltf.scene);
        three_vrm_1.VRMUtils.combineMorphs(vrm);
        vrm.scene.traverse((obj) => { obj.frustumCulled = false; });
        vrm.scene.rotation.y = Math.PI;
        for (let i = 0; i < 60; i++)
            vrm.update(1 / 60);
        scene.add(vrm.scene);
        // Add globe overlay using VRM instance for precise head positioning
        const glowMaterials = avatarType !== 'original' ? addGlobeOverlay(vrm.scene, vrm) : [];
        // Try to load animation
        const mixer = new THREE.AnimationMixer(vrm.scene);
        try {
            const gltfVrma = await loader.loadAsync('../../assets/idle_loop.vrma');
            const clip = (0, three_vrm_animation_1.createVRMAnimationClip)(gltfVrma.userData.vrmAnimations[0], vrm);
            mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();
        }
        catch (e) {
            console.warn('Animation not found, using model without animation');
        }
        return { vrm, mixer, glowMaterials };
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
        }
        catch (e) {
            console.warn('Could not load texture:', file);
        }
    }
    model.traverse((obj) => {
        obj.frustumCulled = false;
        if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (obj.material)
                obj.material.needsUpdate = true;
        }
    });
    // Keep figure orientation and placement unchanged.
    model.rotation.y = Math.PI;
    model.position.y = 0.85;
    model.position.x = 0.15;
    model.scale.multiplyScalar(0.8);
    scene.add(model);
    const glowMaterials = avatarType !== 'original' ? addGlobeOverlay(model, null) : [];
    const mixer = new THREE.AnimationMixer(model);
    if (gltf.animations && gltf.animations.length > 0) {
        const action = mixer.clipAction(gltf.animations[0]);
        action.setLoop(THREE.LoopRepeat).play();
    }
    return { vrm: { scene: model, update: () => { } }, mixer, glowMaterials };
}
