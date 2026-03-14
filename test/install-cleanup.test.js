const assert = require('node:assert');

const { parseInstallCleanupClause } = require('../src/main/automation/intent-router');
const {
	classifyInstallArtifactPath,
	getMountedDiskImages,
	findSourceDmgForVolume,
} = require('../src/main/tools/files');

console.log('Running install cleanup tests...');

// --- classifyInstallArtifactPath ---

assert.deepStrictEqual(
	classifyInstallArtifactPath('/Volumes/Automaker'),
	{ kind: 'mounted-volume', cleanupAction: 'eject', path: '/Volumes/Automaker' },
	'should classify /Volumes/ path as mounted-volume'
);

assert.deepStrictEqual(
	classifyInstallArtifactPath('/Users/abhi/Downloads/App.dmg'),
	{ kind: 'disk-image', cleanupAction: 'trash', path: '/Users/abhi/Downloads/App.dmg' },
	'should classify .dmg as disk-image'
);

assert.deepStrictEqual(
	classifyInstallArtifactPath('/Users/abhi/Downloads/Installer.pkg'),
	{ kind: 'installer-package', cleanupAction: 'trash', path: '/Users/abhi/Downloads/Installer.pkg' },
	'should classify .pkg as installer-package'
);

assert.strictEqual(
	classifyInstallArtifactPath('/Users/abhi/Documents/notes.txt'),
	null,
	'should return null for non-installer paths'
);

assert.strictEqual(
	classifyInstallArtifactPath(''),
	null,
	'should return null for empty path'
);

console.log('  ✓ classifyInstallArtifactPath');

// --- parseInstallCleanupClause ---

{
	const result = parseInstallCleanupClause('clean up the installer dmg', '');
	assert.ok(result, 'should parse "clean up the installer dmg"');
	assert.strictEqual(result.type, 'cleanupInstallArtifact');
	assert.strictEqual(result.combined, true, 'should set combined: true');
	assert.strictEqual(result.appHint, 'Finder');
}

{
	const result = parseInstallCleanupClause('trash the disk image', '');
	assert.ok(result, 'should parse "trash the disk image"');
	assert.strictEqual(result.type, 'cleanupInstallArtifact');
	assert.strictEqual(result.action, 'trash');
	assert.strictEqual(result.combined, true);
}

{
	const result = parseInstallCleanupClause('eject the mounted volume', '');
	assert.ok(result, 'should parse "eject the mounted volume"');
	assert.strictEqual(result.type, 'cleanupInstallArtifact');
	assert.strictEqual(result.action, 'eject');
}

{
	const result = parseInstallCleanupClause('remove the installer package', '');
	assert.ok(result, 'should parse "remove the installer package"');
	assert.strictEqual(result.type, 'cleanupInstallArtifact');
}

{
	const result = parseInstallCleanupClause('delete my homework', '');
	assert.strictEqual(result, null, 'should not parse non-installer cleanup');
}

{
	const result = parseInstallCleanupClause('open Safari', '');
	assert.strictEqual(result, null, 'should not parse non-cleanup actions');
}

console.log('  ✓ parseInstallCleanupClause');

// --- getMountedDiskImages ---

{
	const images = getMountedDiskImages();
	assert.ok(Array.isArray(images), 'should return an array');
	for (const img of images) {
		assert.ok(img.imagePath, 'each image should have imagePath');
		assert.ok(img.mountPoint, 'each image should have mountPoint');
		assert.ok(img.volumeName, 'each image should have volumeName');
		// System volumes should be filtered out
		assert.ok(!/com_apple_|CoreSimulator|BaseSystem/i.test(img.imagePath),
			`should not include system image: ${img.imagePath}`);
		assert.ok(!img.mountPoint.startsWith('/Library/Developer'),
			`should not include developer mount: ${img.mountPoint}`);
	}
}

console.log('  ✓ getMountedDiskImages (live)');

// --- findSourceDmgForVolume ---

{
	const images = getMountedDiskImages();
	if (images.length > 0) {
		const first = images[0];
		const found = findSourceDmgForVolume(first.mountPoint);
		assert.strictEqual(found, first.imagePath,
			`should find source DMG for ${first.mountPoint}`);
	}

	const notFound = findSourceDmgForVolume('/Volumes/NonExistentVolume12345');
	assert.strictEqual(notFound, null, 'should return null for unknown volume');

	const empty = findSourceDmgForVolume('');
	assert.strictEqual(empty, null, 'should return null for empty input');
}

console.log('  ✓ findSourceDmgForVolume');

// --- list_mounted_installers ---

const { list_mounted_installers } = require('../src/main/tools/files');

(async () => {
	const result = await list_mounted_installers();
	assert.strictEqual(result.ok, true, 'list_mounted_installers should return ok: true');
	assert.ok(Array.isArray(result.volumes), 'should have volumes array');
	assert.ok(typeof result.result === 'string', 'should have result string');
	if (result.volumes.length > 0) {
		assert.ok(result.result.includes('→'), 'formatted result should contain arrow separator');
	}
	console.log('  ✓ list_mounted_installers');

	console.log('\nAll install cleanup tests passed ✓');
})();
