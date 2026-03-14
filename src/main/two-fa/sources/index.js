// Source registry: parallel fetch from all enabled adapters, sorted by priority
const log = require('../../logger');

const ALL_SOURCES = [
	require('./keychain-totp'),
	require('./onepassword'),
	require('./local-totp'),
	require('./messages'),
	require('./mail'),
	require('./notifications'),
];

function getEnabledSources(enabledMap = {}) {
	return ALL_SOURCES
		.filter(s => {
			const settingsKey = {
				'keychain-totp': 'keychainTotp',
				'onepassword': 'onePassword',
				'local-totp': 'localTotp',
				'messages': 'messages',
				'mail': 'mail',
				'notifications': 'notifications',
			}[s.name];
			if (settingsKey && enabledMap[settingsKey] === false) return false;
			return s.enabled();
		})
		.sort((a, b) => a.priority - b.priority);
}

async function gatherCodes(context, enabledMap = {}) {
	const sources = getEnabledSources(enabledMap);
	if (!sources.length) return [];

	const results = await Promise.allSettled(
		sources.map(s =>
			s.fetchCode(context)
				.then(r => r ? { ...r, source: s.name } : null)
				.catch(err => { log.warn('2FA-Sources', `${s.name} failed:`, err.message); return null; })
		)
	);

	return results
		.filter(r => r.status === 'fulfilled' && r.value)
		.map(r => r.value)
		.sort((a, b) => {
			if (a.confidence !== b.confidence) return b.confidence - a.confidence;
			return b.timestamp - a.timestamp;
		});
}

module.exports = { gatherCodes, getEnabledSources, ALL_SOURCES };
