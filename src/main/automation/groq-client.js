const { error: logError } = require('../logger');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_TIMEOUT_MS = 8000;

function parseJsonEnvelope(text = '') {
	const match = String(text || '').match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		return JSON.parse(match[0]);
	} catch {
		return null;
	}
}

class GroqClient {
	constructor({ apiKey = '' } = {}) {
		this._apiKey = String(apiKey || '').trim();
	}

	get available() {
		return !!this._apiKey;
	}

	async complete(messages, { model = DEFAULT_MODEL, temperature = 0.2, maxTokens = 256, responseFormat } = {}) {
		if (!this._apiKey) return null;

		const body = {
			model,
			messages,
			temperature,
			max_tokens: maxTokens,
		};
		if (responseFormat) body.response_format = responseFormat;

		try {
			const response = await fetch(GROQ_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this._apiKey}`,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => '');
				logError('GroqClient', `HTTP ${response.status}: ${errorText.slice(0, 200)}`);
				return null;
			}

			const data = await response.json();
			const content = data?.choices?.[0]?.message?.content;
			if (!content) return null;

			if (responseFormat?.type === 'json_object') {
				return parseJsonEnvelope(content);
			}
			return content;
		} catch (err) {
			if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
				logError('GroqClient', `Request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
			} else {
				logError('GroqClient', `Request failed: ${err?.message || err}`);
			}
			return null;
		}
	}
}

module.exports = { GroqClient, parseJsonEnvelope };
