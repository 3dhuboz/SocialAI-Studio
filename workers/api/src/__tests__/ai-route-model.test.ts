import { describe, expect, it } from 'vitest';

import { toAnthropicDirectModel, toOpenRouterGenerationModel } from '../routes/ai';

describe('Anthropic direct model routing', () => {
  it('maps the OpenRouter Haiku 4.5 alias to Anthropic\'s live model id', () => {
    expect(toAnthropicDirectModel('anthropic/claude-haiku-4.5')).toBe('claude-haiku-4-5');
  });

  it('preserves an already valid Anthropic model id', () => {
    expect(toAnthropicDirectModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('maps the direct id back to OpenRouter when hot failover is required', () => {
    expect(toOpenRouterGenerationModel('claude-haiku-4-5')).toBe('anthropic/claude-haiku-4.5');
  });
});
