// Three.js scene, camera, renderer, lighting, resize handler, render loop
import * as THREE from 'three';

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

	const scene = new THREE.Scene();

	const dirLight = new THREE.DirectionalLight(0xffffff, Math.PI);
	dirLight.position.set(1.0, 1.0, 1.0).normalize();
	scene.add(dirLight);

	window.addEventListener('resize', () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	return { renderer, camera, scene };
}
