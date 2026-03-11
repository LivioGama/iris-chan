const fs = require('node:fs');
const path = require('node:path');
const config = require('../../shared/config').default;
const { inferDomain } = require('./skill-policy');
const log = require('../logger');

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
	return new Date().toISOString();
}

class EpisodeRecorder {
	constructor({ irisDir = config.paths.irisDir } = {}) {
		this.filePath = path.join(irisDir, 'episodes.json');
		ensureDir(irisDir);
		this.episodes = [];
	}

	beginEpisode({ taskId = '', goal = '', appHint = '' } = {}) {
		const id = taskId || `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		this.episodes.push({
			id,
			sessionId: null,
			turnId: null,
			taskId,
			goal,
			userText: goal,
			guidanceText: '',
			appHint,
			domain: inferDomain(`${goal} ${appHint}`),
			tierPath: [],
			resolverIds: [],
			failedTools: [],
			successfulTools: [],
			classification: '',
			issueSignature: '',
			steps: [],
			status: 'running',
			successType: '',
			createdAt: nowIso(),
			updatedAt: nowIso(),
		});
		if (this.episodes.length > 100) this.episodes = this.episodes.slice(-100);
		this._flush();
		return id;
	}

	recordAttempt(taskId, attempt = {}) {
		const episode = this.episodes.find((item) => item.taskId === taskId || item.id === taskId);
		if (!episode) return;
		episode.tierPath.push(attempt.tier || 'unknown');
		if (attempt.resolverId) {
			episode.resolverIds.push(attempt.resolverId);
			episode.resolverIds = Array.from(new Set(episode.resolverIds));
		}
		if (attempt.successType === 'true_success' || attempt.successType === 'technical_success') {
			episode.successfulTools.push(attempt.type || '');
		} else if (attempt.successType === 'false_positive' || attempt.success === false) {
			episode.failedTools.push(attempt.type || '');
		}
		episode.successfulTools = Array.from(new Set(episode.successfulTools.filter(Boolean)));
		episode.failedTools = Array.from(new Set(episode.failedTools.filter(Boolean)));
		episode.steps.push({ ...attempt, at: nowIso() });
		episode.updatedAt = nowIso();
		this._flush();
	}

	finishEpisode(taskId, summary = {}) {
		const episode = this.episodes.find((item) => item.taskId === taskId || item.id === taskId);
		if (!episode) return;
		episode.status = summary.ok === false ? 'failed' : 'completed';
		episode.successType = summary.successType || (summary.ok === false ? 'failed' : 'true_success');
		episode.summary = summary.result || '';
		if (summary.userText) episode.userText = summary.userText;
		if (summary.guidanceText) episode.guidanceText = summary.guidanceText;
		if (summary.classification) episode.classification = summary.classification;
		if (summary.issueSignature) episode.issueSignature = summary.issueSignature;
		episode.updatedAt = nowIso();
		log.info('Learning', `Episode finished: task=${taskId} domain=${episode.domain} successType=${episode.successType} status=${episode.status}`);
		this._flush();
	}

	_flush() {
		fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, updatedAt: nowIso(), episodes: this.episodes }, null, 2), 'utf8');
	}
}

module.exports = {
	EpisodeRecorder,
};
