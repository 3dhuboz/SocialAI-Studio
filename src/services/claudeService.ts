const PROXY = '/.netlify/functions/claude-proxy';

const proxyHeaders = (): Record<string, string> => {
  const key = localStorage.getItem('sai_claude_key') || '';
  return {
    'Content-Type': 'application/json',
    ...(key ? { 'X-Claude-Key': key } : {}),
  };
};

export const ClaudeService = {
  isConfigured: () => !!localStorage.getItem('sai_claude_key'),

  /**
   * Generate text via Claude. Throws on error.
   */
  generate: async (
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> => {
    const res = await fetch(`${PROXY}?action=generate`, {
      method: 'POST',
      headers: proxyHeaders(),
      body: JSON.stringify({
        prompt,
        systemPrompt: options?.systemPrompt,
        temperature: options?.temperature ?? 0.8,
        maxTokens: options?.maxTokens ?? 1024,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Claude generation failed');
    return data.text as string;
  },
};
