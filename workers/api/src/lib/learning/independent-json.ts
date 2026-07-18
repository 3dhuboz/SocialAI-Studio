import type { Env } from '../../env';
import { callAnthropicDirect, callOpenRouter } from '../anthropic';

export interface IndependentCallContext {
  operation: string;
  userId: string;
  clientId: string | null;
  postId: string | null;
}

export interface IndependentJsonResult {
  text: string;
  provider: string;
  model: string;
}

export interface IndependentJsonDeps {
  callAnthropic: typeof callAnthropicDirect;
  callOpenRouter: typeof callOpenRouter;
}

const defaultDeps: IndependentJsonDeps = {
  callAnthropic: callAnthropicDirect,
  callOpenRouter,
};
const INDEPENDENT_JSON_MAX_TOKENS = 2400;

function normalizeJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const objectText = candidate.slice(start, index + 1).trim();
        const remainder = `${candidate.slice(0, start)}${candidate.slice(index + 1)}`.trim();
        if (!remainder) return objectText;
        if (/^(?:here(?:'s| is)?\s*(?:the\s*)?(?:json|result)?[:.\s-]*|json[:.\s-]*)$/i.test(remainder)) {
          return objectText;
        }
        break;
      }
    }
  }
  return candidate;
}

export async function callIndependentJson(
  env: Env,
  systemPrompt: string,
  prompt: string,
  context: IndependentCallContext,
  deps: IndependentJsonDeps = defaultDeps,
): Promise<IndependentJsonResult> {
  const providers: Array<{
    provider: string;
    model: string;
    call: () => Promise<{ text: string }>;
  }> = [];

  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      call: () => deps.callAnthropic({
        apiKey: env.ANTHROPIC_API_KEY!,
        model: 'claude-haiku-4-5',
        systemPrompt,
        prompt,
        temperature: 0,
        maxTokens: INDEPENDENT_JSON_MAX_TOKENS,
        responseFormat: 'json',
        metering: { env, ...context },
      }),
    });
  }

  if (env.OPENROUTER_API_KEY) {
    providers.push({
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
      call: () => deps.callOpenRouter(
        env.OPENROUTER_API_KEY!,
        systemPrompt,
        prompt,
        0,
        INDEPENDENT_JSON_MAX_TOKENS,
        {
          responseFormat: 'json',
          metering: { env, ...context },
        },
      ),
    });
  }

  const failures: string[] = [];
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await provider.call();
        const text = normalizeJsonText(response.text);
        if (!text) throw new Error('empty response');
        return {
          text,
          provider: provider.provider,
          model: provider.model,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${provider.provider}:${attempt}:${message}`);
      }
    }
  }

  throw new Error(
    `Independent critic providers unavailable: ${failures.join(' | ') || 'none configured'}`,
  );
}
