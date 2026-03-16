const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

interface ClassifyResult {
  intents: string[];
  confidence: number;
  toolHints: string[];
}

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqClientOptions {
  apiKey: string;
  logger: { debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export const createGroqClient = ({ apiKey, logger }: GroqClientOptions) => {
  const complete = async (messages: GroqMessage[], temperature = 0.3, jsonMode = false): Promise<string> => {
    const body: Record<string, unknown> = {
      model: MODEL,
      messages,
      temperature,
      max_tokens: 512,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Groq API ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '{}';
  };

  const classify = async (text: string, context: Record<string, unknown> = {}): Promise<ClassifyResult> => {
    const systemPrompt = [
      'You are an intent classifier. Given the user context, predict intents.',
      'Respond with JSON: { "intents": string[], "confidence": number (0-1), "toolHints": string[] }',
      'intents: what the user is likely trying to do (e.g. "write-code", "browse-docs", "communicate")',
      'toolHints: tools or actions that might help (e.g. "open-terminal", "search-web", "draft-email")',
    ].join('\n');

    const userContent = JSON.stringify({ text, context });

    try {
      const raw = await complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ], 0.3, true);

      const parsed = JSON.parse(raw) as Partial<ClassifyResult>;
      return {
        intents: Array.isArray(parsed.intents) ? parsed.intents : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        toolHints: Array.isArray(parsed.toolHints) ? parsed.toolHints : [],
      };
    } catch (err) {
      logger.error('Groq classify failed:', err);
      return { intents: [], confidence: 0, toolHints: [] };
    }
  };

  return { classify, complete };
};

export type GroqClient = ReturnType<typeof createGroqClient>;
