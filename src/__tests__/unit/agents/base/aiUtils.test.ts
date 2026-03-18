import { describe, expect, it, vi } from 'vitest';
import { callAIWithRetry } from '@/agents/base/aiUtils';
import type { AIAdapter, AIMessage } from '@/adapters/types';

function createAiAdapter(responses: string[]): AIAdapter {
  return {
    chat: vi
      .fn()
      .mockImplementation(async () => ({
        content: responses.shift() ?? responses[responses.length - 1] ?? '',
        inputTokens: 10,
        outputTokens: 10
      })),
    stream: vi.fn()
  };
}

const messages: AIMessage[] = [{ role: 'user', content: '测试一下' }];

describe('callAIWithRetry', () => {
  it('returns immediately when first response is valid json', async () => {
    const ai = createAiAdapter(['{"ok":true}']);

    const result = await callAIWithRetry(ai, messages, {});

    expect(result).toEqual({ ok: true });
    expect(ai.chat).toHaveBeenCalledTimes(1);
  });

  it('rescues noisy json on the first response without retrying', async () => {
    const ai = createAiAdapter(['好的，结果如下：{"ok":true,"items":[1,2]}']);

    const result = await callAIWithRetry(ai, messages, {});

    expect(result).toEqual({ ok: true, items: [1, 2] });
    expect(ai.chat).toHaveBeenCalledTimes(1);
  });

  it('retries once when the first response cannot be parsed', async () => {
    const ai = createAiAdapter([
      '这不是 JSON',
      '{"approved":true,"issues":[],"suggestions":[]}'
    ]);

    const result = await callAIWithRetry(ai, messages, {});

    expect(result).toEqual({
      approved: true,
      issues: [],
      suggestions: []
    });
    expect(ai.chat).toHaveBeenCalledTimes(2);
  });

  it('throws when all retry attempts fail', async () => {
    const ai = createAiAdapter(['完全错误', '还是完全错误']);

    await expect(callAIWithRetry(ai, messages, {})).rejects.toThrow(/无法解析 AI 返回的 JSON|AI 返回内容为空/);
    expect(ai.chat).toHaveBeenCalledTimes(2);
  });
});
