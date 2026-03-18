import { afterEach, describe, expect, it } from 'vitest';
import { resolveModel } from '@/adapters/ai/providers';
import { selectModel } from '@/adapters/ai/AIModelAdapter';

describe('providers', () => {
  afterEach(() => {
    delete process.env.ZHONGSHU_MODEL;
    delete process.env.DEFAULT_AI_MODEL;
  });

  it('resolveModel finds provider by alias', () => {
    const resolved = resolveModel('glm-flash');

    expect(resolved?.provider.name).toBe('zhipu');
    expect(resolved?.model.id).toBe('glm-4-flash');
  });

  it('resolveModel finds doubao provider by alias', () => {
    const resolved = resolveModel('doubao-fast');

    expect(resolved?.provider.name).toBe('doubao');
    expect(resolved?.provider.apiKeyEnv).toBe('ARK_API_KEY');
  });

  it('resolveModel finds provider by model id', () => {
    const resolved = resolveModel('glm-4');

    expect(resolved?.provider.name).toBe('zhipu');
  });

  it('returns null for unknown model', () => {
    expect(resolveModel('unknown-model')).toBeNull();
  });

  it('marks minimax provider as think-stripping', () => {
    const resolved = resolveModel('minimax');

    expect(resolved?.provider.stripThinkBlocks).toBe(true);
  });

  it('does not enable think stripping for glm provider', () => {
    const resolved = resolveModel('glm');

    expect(resolved?.provider.stripThinkBlocks).not.toBe(true);
  });

  it('selectModel prefers agent specific environment variable', () => {
    process.env.ZHONGSHU_MODEL = 'glm-4-flash';
    process.env.DEFAULT_AI_MODEL = 'glm';

    expect(selectModel('zhongshu')).toBe('glm-4-flash');
  });
});
