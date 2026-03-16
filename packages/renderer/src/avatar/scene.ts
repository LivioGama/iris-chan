import * as THREE from 'three';

export const createScene = (canvas?: HTMLCanvasElement) => {
  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  if (!canvas) {
    document.body.appendChild(renderer.domElement);
  }

  // ── Camera ──
  const camera = new THREE.PerspectiveCamera(
    30,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 1.05, 2.4);
  camera.lookAt(0, 1.05, 0);
  // Offset avatar to the left — UI on the right
  camera.setViewOffset(
    window.innerWidth,
    window.innerHeight,
    window.innerWidth * 0.22,
    0,
    window.innerWidth,
    window.innerHeight,
  );

  // ── Scene ──
  const scene = new THREE.Scene();

  // ── Lights ──
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(1, 2, 2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xb4c6e7, 0.5);
  fillLight.position.set(-2, 1, 1);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffeedd, 0.4);
  rimLight.position.set(0, 1, -2);
  scene.add(rimLight);

  // ── Avatar light rig (reactive to voice state) ──
  const coolSpot = new THREE.SpotLight(0x84ddff, 0.8, 10, Math.PI / 4);
  coolSpot.position.set(-1.5, 2, 1);
  scene.add(coolSpot);

  const warmSpot = new THREE.SpotLight(0xffd2a6, 0.6, 10, Math.PI / 4);
  warmSpot.position.set(1.5, 1.5, 1.5);
  scene.add(warmSpot);

  // ── Resize handler ──
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * 0.22, 0, w, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ── Raycaster for avatar hitbox ──
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  return {
    renderer,
    camera,
    scene,
    coolSpot,
    warmSpot,
    raycaster,
    mouse,

    updateLightRig(
      voiceState: 'idle' | 'thinking' | 'speaking',
      volume: number,
      elapsed: number,
    ) {
      const t = elapsed / 1000;

      if (voiceState === 'thinking') {
        coolSpot.intensity = 1.2 + 0.3 * Math.sin(t * 0.78);
        warmSpot.intensity = 1.0 + 0.2 * Math.sin(t * 0.78 + 1);
      } else if (voiceState === 'speaking') {
        const damped = Math.max(0.3, 1.0 - volume * 0.5);
        coolSpot.intensity = 0.6 * damped;
        warmSpot.intensity = 0.5 * damped;
      } else {
        coolSpot.intensity = 0.8 + 0.15 * Math.sin(t * 0.27);
        warmSpot.intensity = 0.6 + 0.1 * Math.sin(t * 0.47);
      }

      // Subtle position drift
      coolSpot.position.x = -1.5 + 0.3 * Math.sin(t * 0.31);
      warmSpot.position.x = 1.5 + 0.2 * Math.sin(t * 0.43);
    },

    render() {
      renderer.render(scene, camera);
    },

    dispose() {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
};
