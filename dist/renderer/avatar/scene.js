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
exports.createScene = createScene;
exports.createScenePerformanceProbe = createScenePerformanceProbe;
// Three.js scene, camera, renderer, lighting, resize handler, render loop
const THREE = __importStar(require("three"));
function createScene() {
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, Math.PI);
    dirLight.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(dirLight);
    window.addEventListener('resize', () => {
        const rw = window.innerWidth;
        const rh = window.innerHeight;
        camera.aspect = rw / rh;
        camera.setViewOffset(rw, rh, Math.round(rw * 0.22), 0, rw, rh);
        camera.updateProjectionMatrix();
        renderer.setSize(rw, rh);
    });
    return { renderer, camera, scene };
}
function createScenePerformanceProbe({ renderer, performanceMonitor }) {
    return {
        recordFrame(deltaSeconds) {
            if (!performanceMonitor || !renderer)
                return;
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
