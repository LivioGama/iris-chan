async function describeLink({ url, title, host }) {
	if (!process.env.GROQ_API_KEY || typeof fetch !== 'function') return null;
	if (!url && !title) return null;

	try {
		const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${process.env.GROQ_API_KEY}`,
			},
			body: JSON.stringify({
				model: 'llama-3.3-70b-versatile',
				temperature: 0,
				max_tokens: 150,
				messages: [
					{
						role: 'system',
						content:
							'Write a 1-2 sentence description of this web page based on its URL and title. Be concise and factual. If the title is descriptive enough, summarize it. If ambiguous, infer from the URL structure and domain.',
					},
					{
						role: 'user',
						content: `URL: ${url}\nTitle: ${title || '(untitled)'}\nDomain: ${host || ''}`,
					},
				],
			}),
		});
		if (!response.ok) return null;
		const data = await response.json();
		return data?.choices?.[0]?.message?.content?.trim() || null;
	} catch (err) {
		console.error('[LinkCapture] Groq describe error:', err.message);
		return null;
	}
}

module.exports = { describeLink };
