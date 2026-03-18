import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIModelAdapter, selectModel } from '@/adapters/ai/AIModelAdapter';
import type { AnthropicMessageClient } from '@/adapters/types';

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

describe('AIModelAdapter', () => {
  afterEach(() => {
    delete process.env.DEFAULT_AI_MODEL;
    delete process.env.ZHIPU_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_BASE;
    delete process.env.ZHONGSHU_MODEL;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
  });

  it('chat uses Anthropic SDK for claude', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'hello from claude' }],
      usage: { input_tokens: 100, output_tokens: 50 }
    });
    const anthropicClient: AnthropicMessageClient = {
      messages: { create }
    };
    const adapter = new AIModelAdapter({
      anthropicApiKey: 'ant-key',
      anthropicClient
    });

    await adapter.chat([{ role: 'user', content: 'hello' }], { model: 'claude' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-sonnet-4-6'
    });
  });

  it('chat uses provider config for deepseek', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'hello from deepseek' } }],
        usage: { prompt_tokens: 200, completion_tokens: 100 }
      })
    );
    const adapter = new AIModelAdapter({
      fetcher
    });

    await adapter.chat([{ role: 'user', content: 'hello' }], { model: 'deepseek' });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain('deepseek');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST'
    });
  });

  it('chat uses minimax provider config and strips think blocks', async () => {
    process.env.MINIMAX_API_KEY = 'minimax-key';
    process.env.MINIMAX_API_BASE = 'https://api.minimaxi.com/v1';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '<think>内部推理</think>\n测试回复' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        base_resp: { status_code: 0 }
      })
    );
    const onUsage = vi.fn();
    const adapter = new AIModelAdapter({
      fetcher
    });

    const result = await adapter.chat([{ role: 'user', content: 'hello minimax' }], {
      model: 'minimax',
      onUsage
    });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain('minimaxi.com');
    expect(result.content).toBe('测试回复');
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M2.5',
        inputTokens: 10,
        outputTokens: 20
      })
    );
  });

  it('throws when openai-compatible provider key is missing', async () => {
    const adapter = new AIModelAdapter({
      fetcher: vi.fn()
    });

    await expect(adapter.chat([{ role: 'user', content: 'hello zhipu' }], { model: 'glm' })).rejects.toThrow(
      'ZHIPU_API_KEY'
    );
  });

  it('throws when minimax returns api error', async () => {
    process.env.MINIMAX_API_KEY = 'minimax-key';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        base_resp: { status_code: 1002, status_msg: 'Invalid API Key' }
      })
    );
    const adapter = new AIModelAdapter({
      fetcher
    });

    await expect(adapter.chat([{ role: 'user', content: 'hello minimax' }], { model: 'minimax' })).rejects.toThrow(
      'Invalid API Key'
    );
  });

  it('chat throws helpful error for unknown alias', async () => {
    const adapter = new AIModelAdapter({
      fetcher: vi.fn()
    });

    await expect(adapter.chat([{ role: 'user', content: 'hello' }], { model: 'unknown-model' })).rejects.toThrow(
      '未知的模型：unknown-model'
    );

    try {
      await adapter.chat([{ role: 'user', content: 'hello' }], { model: 'unknown-model' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('claude');
      expect(message).toContain('glm-flash');
      expect(message).toContain('minimax');
    }
  });

  it('selectModel prefers agent specific env and falls back to default', () => {
    process.env.ZHONGSHU_MODEL = 'glm-4-flash';
    process.env.DEFAULT_AI_MODEL = 'glm';

    expect(selectModel('zhongshu')).toBe('glm-4-flash');
    expect(selectModel('menxia')).toBe('glm');
  });

  it('stream yields multiple chunks for openai-compatible provider', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hello "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n'
      ])
    );
    const adapter = new AIModelAdapter({
      fetcher
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([{ role: 'user', content: 'stream please' }], { model: 'deepseek' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['hello ', 'world']);
  });
});
