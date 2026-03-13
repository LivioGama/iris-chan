const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildAugmentedPath, createCommandEnv, getFishUserPaths } = require('../src/main/path-env');

console.log('Running PATH environment tests...');

function containsEntry(pathValue, entry) {
	return String(pathValue || '').split(path.delimiter).includes(entry);
}

async function main() {
	const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-path-env-'));
	const fishDir = path.join(tempHome, '.config', 'fish');
	const localBin = path.join(tempHome, 'local', 'bin');
	const fishBin = path.join(tempHome, 'fish-bin');
	const universalBin = path.join(tempHome, 'uvar-bin');

	fs.mkdirSync(fishDir, { recursive: true });
	fs.writeFileSync(path.join(fishDir, 'config.fish'), [
		`fish_add_path ${fishBin}`,
		`set -U fish_user_paths ${localBin} $fish_user_paths`,
	].join('\n'));
	fs.writeFileSync(path.join(fishDir, 'fish_variables'), `# This file contains fish universal variable definitions.\nSETUVAR fish_user_paths:${universalBin}\\x1e${localBin}\n`);

	try {
		const fishPaths = getFishUserPaths(tempHome);
		assert.deepStrictEqual(
			fishPaths,
			[fishBin, localBin, universalBin, localBin],
			'fish config and fish_variables entries should both be discovered in order'
		);

		const augmented = buildAugmentedPath('/usr/bin:/bin', { homeDir: tempHome });
		assert.ok(containsEntry(augmented, localBin), 'augmented PATH should include ~/local/bin');
		assert.ok(containsEntry(augmented, fishBin), 'augmented PATH should include fish_add_path entries');
		assert.ok(containsEntry(augmented, universalBin), 'augmented PATH should include fish universal paths');
		assert.ok(containsEntry(augmented, '/opt/homebrew/bin'), 'augmented PATH should include Homebrew bin');
		assert.ok(containsEntry(augmented, '/usr/local/bin'), 'augmented PATH should include /usr/local/bin');

		const env = createCommandEnv({ TEST_TOKEN: 'ok', PATH: '/usr/bin:/bin' }, { homeDir: tempHome });
		assert.strictEqual(env.TEST_TOKEN, 'ok', 'custom env vars should be preserved');
		assert.ok(containsEntry(env.PATH, localBin), 'command env should surface local bin to child processes');
		assert.ok(containsEntry(env.PATH, fishBin), 'command env should surface fish-configured bin to child processes');
	} finally {
		fs.rmSync(tempHome, { recursive: true, force: true });
	}

	console.log('PATH environment tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
