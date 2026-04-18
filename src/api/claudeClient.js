const API_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export class ClaudeApiError extends Error {
  constructor(message, { status, type, retriable } = {}) {
    super(message);
    this.name = 'ClaudeApiError';
    this.status = status;
    this.type = type;
    this.retriable = retriable;
  }
}

export async function callClaude({
  apiKey,
  model,
  systemPrompt,
  userMessage,
  maxTokens = 1024,
  timeoutMs = 30000,
}) {
  if (!apiKey) throw new ClaudeApiError('API key not configured', { type: 'config' });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new ClaudeApiError(errorBody?.error?.message || `API error: ${response.status}`, {
        status: response.status,
        type: errorBody?.error?.type,
        retriable: response.status === 429 || response.status >= 500,
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new ClaudeApiError('Empty response from API', { type: 'parse' });

    return { text, model: data.model, usage: data.usage };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError')
      throw new ClaudeApiError('Request timed out', { type: 'timeout', retriable: true });
    if (err instanceof ClaudeApiError) throw err;
    throw new ClaudeApiError(`Network error: ${err.message}`, {
      type: 'network',
      retriable: true,
    });
  }
}
