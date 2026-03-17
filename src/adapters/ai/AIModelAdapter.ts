import Anthropic from '@anthropic-ai/sdk';
import type {
  AIAdapter,
  AIAdapterConfig,
  AIMessage,
  AIOptions,
  AIResponse,
  AnthropicMessageClient,
  SupportedAIModel
} from '@/adapters/types';
import type { AgentType } from '@/lib/schema';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

function computeCost(model: SupportedAIModel, inputTokens: number, outputTokens: number): number {
  if (model === 'deepseek') {
    return (inputTokens * 0.14 + outputTokens * 0.28) / 1_000_000;
  }

  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

function splitMessages(messages: AIMessage[]) {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');

  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  return { system, conversation };
}

function extractAnthropicText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'object' && part && 'text' in part) {
        return String((part as { text: unknown }).text ?? '');
      }
      return '';
    })
    .join('');
}

async function* streamSseResponse(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as {
          delta?: { text?: string };
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = parsed.delta?.text ?? parsed.choices?.[0]?.delta?.content;
        if (token) {
          yield token;
        }
      } catch {
        // Ignore malformed SSE lines so streaming can continue.
      }
    }
  }
}

export function selectModel(agentType: AgentType): SupportedAIModel {
  if (agentType === 'zhongshu' || agentType === 'menxia') {
    return 'claude';
  }

  if (agentType === 'libu_li2' || agentType === 'libu_hu') {
    return 'deepseek';
  }

  return 'claude';
}

export class AIModelAdapter implements AIAdapter {
  private config: AIAdapterConfig;

  private fetcher: typeof fetch;

  private anthropicClient: AnthropicMessageClient;

  constructor(config: AIAdapterConfig) {
    this.config = {
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      ...config
    };
    this.fetcher = config.fetcher ?? fetch;
    this.anthropicClient =
      config.anthropicClient ??
      new Anthropic({
        apiKey: config.anthropicApiKey
      });
  }

  async chat(messages: AIMessage[], options: AIOptions): Promise<AIResponse> {
    const model = options.model ?? 'claude';
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens ?? 1024;

    if (model === 'deepseek') {
      return this.chatWithDeepSeek(messages, { ...options, model, temperature, maxTokens });
    }

    return this.chatWithClaude(messages, { ...options, model, temperature, maxTokens });
  }

  async *stream(messages: AIMessage[], options: AIOptions): AsyncGenerator<string> {
    const model = options.model ?? 'claude';
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens ?? 1024;

    if (model === 'deepseek') {
      const response = await this.fetcher(`${this.config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.deepseekApiKey ?? ''}`
        },
        body: JSON.stringify({
          model: DEFAULT_DEEPSEEK_MODEL,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          messages
        })
      });
      yield* streamSseResponse(response);
      return;
    }

    const { system, conversation } = splitMessages(messages);
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.anthropicApiKey ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.config.anthropicModel,
        stream: true,
        temperature,
        max_tokens: maxTokens,
        system,
        messages: conversation
      })
    });
    yield* streamSseResponse(response);
  }

  private async chatWithClaude(
    messages: AIMessage[],
    options: AIOptions & { model: SupportedAIModel; temperature: number; maxTokens: number }
  ): Promise<AIResponse> {
    const { system, conversation } = splitMessages(messages);
    const response = await this.anthropicClient.messages.create({
      model: this.config.anthropicModel,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system,
      messages: conversation
    });

    const usage = (response.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const result: AIResponse = {
      content: extractAnthropicText(response.content),
      inputTokens,
      outputTokens
    };

    options.onUsage?.({
      model: 'claude',
      inputTokens,
      outputTokens,
      costUsd: computeCost('claude', inputTokens, outputTokens)
    });

    return result;
  }

  private async chatWithDeepSeek(
    messages: AIMessage[],
    options: AIOptions & { model: SupportedAIModel; temperature: number; maxTokens: number }
  ): Promise<AIResponse> {
    const response = await this.fetcher(`${this.config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.deepseekApiKey ?? ''}`
      },
      body: JSON.stringify({
        model: DEFAULT_DEEPSEEK_MODEL,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        messages
      })
    });
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const result: AIResponse = {
      content: data.choices?.[0]?.message?.content ?? '',
      inputTokens,
      outputTokens
    };

    options.onUsage?.({
      model: 'deepseek',
      inputTokens,
      outputTokens,
      costUsd: computeCost('deepseek', inputTokens, outputTokens)
    });

    return result;
  }
}
