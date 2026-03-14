const convexStore = require('../convex-store');

async function save_observation(args) {
	const description = String(args.description || '').trim();
	const appName = String(args.app_name || '').trim();
	const trigger = String(args.trigger || 'user_requested').trim();
	const note = args.note ? String(args.note).trim() : undefined;

	if (!description) {
		return 'Error: description is required.';
	}

	const tags = String(args.tags || '')
		.split(',')
		.map(t => t.trim())
		.filter(Boolean);

	const observation = {
		description,
		appName: appName || 'Unknown',
		tags,
		captureId: String(args.capture_id || `obs_${Date.now()}`),
		sessionId: convexStore._private?.currentSessionId || `session_${Date.now()}`,
		timestamp: Date.now(),
		trigger,
	};
	if (note) observation.note = note;

	try {
		await convexStore.saveObservation(observation);
		return 'Observation saved.';
	} catch (err) {
		return `Error saving observation: ${err.message}`;
	}
}

async function recall_observations(args) {
	const query = String(args.query || '').trim();
	if (!query) {
		return 'Error: query is required.';
	}

	const limit = Number(args.limit) || 5;
	const appFilter = args.app_filter ? String(args.app_filter).trim() : null;

	try {
		const results = await convexStore.searchObservations(query, limit, appFilter);
		if (!results || !results.length) {
			return 'No matching observations found.';
		}

		const now = Date.now();
		const lines = results.map((obs, i) => {
			const agoMs = now - (obs.timestamp || 0);
			const agoMin = Math.round(agoMs / 60000);
			let agoStr;
			if (agoMin < 1) agoStr = 'just now';
			else if (agoMin < 60) agoStr = `${agoMin}m ago`;
			else if (agoMin < 1440) agoStr = `${Math.round(agoMin / 60)}h ago`;
			else agoStr = `${Math.round(agoMin / 1440)}d ago`;

			const app = obs.appName || 'Unknown';
			const tags = Array.isArray(obs.tags) && obs.tags.length ? ` [${obs.tags.join(', ')}]` : '';
			const note = obs.note ? ` (Note: ${obs.note})` : '';
			return `${i + 1}. ${agoStr} [${app}]${tags}: ${obs.description}${note}`;
		});

		return `Found ${results.length} observation(s):\n${lines.join('\n')}`;
	} catch (err) {
		return `Error searching observations: ${err.message}`;
	}
}

module.exports = { save_observation, recall_observations };
