let registered = false;

function ensureTsNode() {
	if (registered) return;
	registered = true;
	require('ts-node').register({ transpileOnly: true });
}

ensureTsNode();

module.exports = require('./config.ts');
