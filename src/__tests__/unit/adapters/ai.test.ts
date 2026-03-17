import { describe, expect, it, vi } from 'vitest';
import { AIModelAdapter, selectModel } from '@/adapters/ai/AIModelAdapter';
import type { AnthropicMessageClient } from '@/adapters/types';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
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

    await adapter.chat([{ role: 'user', content: 'hello' }], {});

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-sonnet-4-6'
    });
  });

  it('chat uses deepseek compatible endpoint', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'hello from deepseek' } }],
          usage: { prompt_tokens: 200, completion_tokens: 100 }
        })
      );
    const adapter = new AIModelAdapter({
      deepseekApiKey: 'ds-key',
      fetcher
    });

    await adapter.chat([{ role: 'user', content: 'hello' }], { model: 'deepseek' });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain('deepseek');
  });

  it('onUsage reports claude and deepseek costs correctly', async () => {
    const usageSpy = vi.fn();
    const anthropicClient: AnthropicMessageClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ text: 'claude' }],
          usage: { input_tokens: 1000, output_tokens: 500 }
        })
      }
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'deepseek' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 }
        })
      );
    const adapter = new AIModelAdapter({
      anthropicApiKey: 'ant-key',
      anthropicClient,
      deepseekApiKey: 'ds-key',
      fetcher
    });

    await adapter.chat([{ role: 'user', content: 'hi' }], { onUsage: usageSpy });
    await adapter.chat([{ role: 'user', content: 'hi' }], { model: 'deepseek', onUsage: usageSpy });

    expect(usageSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'claude',
        costUsd: (1000 * 3 + 500 * 15) / 1_000_000
      })
    );
    expect(usageSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: 'deepseek',
        costUsd: (1000 * 0.14 + 500 * 0.28) / 1_000_000
      })
    );
  });

  it('selectModel returns expected provider', () => {
    expect(selectModel('zhongshu')).toBe('claude');
    expect(selectModel('libu_li2')).toBe('deepseek');
  });

  it('stream yields multiple chunks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hello "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n'
      ])
    );
    const adapter = new AIModelAdapter({
      deepseekApiKey: 'ds-key',
      fetcher
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([{ role: 'user', content: 'stream please' }], { model: 'deepseek' })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join('')).toBe('hello world');
  });
});
