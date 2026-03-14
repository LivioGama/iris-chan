const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const THREE = require('three');

async function main() {
	const sceneUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/avatar/scene.js')).href;
	const { createAvatarLightRig } = await import(sceneUrl);

	const root = new THREE.Group();
	const rig = createAvatarLightRig();
	rig.attach(root);

	assert.strictEqual(rig.group.parent, root, 'light rig should attach to the avatar root');

	for (let i = 0; i < 30; i++) {
		rig.update({ elapsedTime: i / 10, thinking: true, speaking: false, speakingVolume: 0 });
	}
	const thinkingCool = rig.coolSpot.intensity;
	const thinkingWarm = rig.warmSpot.intensity;

	for (let i = 0; i < 30; i++) {
		rig.update({ elapsedTime: 3 + i / 10, thinking: false, speaking: true, speakingVolume: 0.35 });
	}
	const speakingCool = rig.coolSpot.intensity;
	const speakingWarm = rig.warmSpot.intensity;

	assert.ok(thinkingCool > speakingCool, 'thinking should drive a stronger cool spotlight than speaking');
	assert.ok(thinkingWarm > speakingWarm, 'thinking should drive a stronger warm spotlight than speaking');
	assert.ok(rig.coolSpot.target === rig.group.children[1], 'cool spotlight target should stay attached to the rig');
	assert.ok(rig.warmSpot.target === rig.group.children[3], 'warm spotlight target should stay attached to the rig');

	console.log('avatar light rig tests passed.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
