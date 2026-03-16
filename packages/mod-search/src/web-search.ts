const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

export interface WebSearchResult {
  query: string;
  text: string;
  error?: string;
}

export const webSearch = async (
  query: string,
  apiKey: string,
): Promise<WebSearchResult> => {
  if (!apiKey) {
    return { query, text: '', error: 'GEMINI_API_KEY not configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Search the web for: ${query}\n\nReturn a concise summary of the top results with sources.`,
              },
            ],
          },
        ],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { query, text: '', error: `Gemini ${res.status}: ${body}` };
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('\n')
        .trim() ?? '';

    return { query, text };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Web search timed out (10s)'
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    return { query, text: '', error: message };
  } finally {
    clearTimeout(timeout);
  }
};
