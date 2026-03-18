import Anthropic from '@anthropic-ai/sdk';
import type {
  AIAdapter,
  AIAdapterConfig,
  AIMessage,
  AIOptions,
  AIResponse,
  AnthropicMessageClient
} from '@/adapters/types';
import type { AgentType } from '@/lib/schema';
import { agentLogger } from '@/workers/logger';
import { getAllAliases, resolveModel, type ModelConfig, type ProviderConfig } from './providers';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

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

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI 请求超时（${timeoutMs}ms）：${input}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getAgentModelOverride(agentType?: string): string | undefined {
  if (!agentType) {
    return undefined;
  }

  const agentKey = `${agentType.toUpperCase()}_MODEL`;
  return process.env[agentKey];
}

function getRequestPath(provider: ProviderConfig): string {
  return provider.chatPath ?? '/chat/completions';
}

function getProviderApiKey(config: AIAdapterConfig, provider: ProviderConfig): string | undefined {
  const explicitKeys = config.apiKeys?.[provider.name];
  if (explicitKeys) {
    return explicitKeys;
  }

  if (provider.name === 'claude') {
    return config.anthropicApiKey ?? process.env[provider.apiKeyEnv];
  }

  if (provider.name === 'deepseek' || provider.name === 'deepseek-reasoner') {
    return config.deepseekApiKey ?? process.env[provider.apiKeyEnv];
  }

  if (provider.name === 'minimax') {
    return config.minimaxApiKey ?? process.env[provider.apiKeyEnv];
  }

  return process.env[provider.apiKeyEnv];
}

export function selectModel(agentType: AgentType): string {
  const agentOverride = getAgentModelOverride(agentType);
  if (agentOverride) {
    return agentOverride;
  }

  return process.env.DEFAULT_AI_MODEL ?? 'claude';
}

export class AIModelAdapter implements AIAdapter {
  private config: AIAdapterConfig;

  private fetcher: typeof fetch;

  private anthropicClient: AnthropicMessageClient;

  constructor(config: AIAdapterConfig) {
    this.config = {
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      ...config
    };
    this.fetcher = config.fetcher ?? fetch;
    this.anthropicClient =
      config.anthropicClient ??
      new Anthropic({
        apiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY
      });
  }

  async chat(messages: AIMessage[], options: AIOptions = {}): Promise<AIResponse> {
    const modelAlias = options.model ?? getAgentModelOverride(options.agentType) ?? process.env.DEFAULT_AI_MODEL ?? 'claude';
    const resolved = resolveModel(modelAlias);

    if (!resolved) {
      throw new Error(`未知的模型：${modelAlias}。可用模型别名：${getAllAliases().join(', ')}`);
    }

    const { provider, model } = resolved;

    if (provider.name === 'claude') {
      return this.callClaude(messages, options, model);
    }

    return this.callOpenAICompatible(messages, options, provider, model);
  }

  async *stream(messages: AIMessage[], options: AIOptions = {}): AsyncGenerator<string> {
    const modelAlias = options.model ?? getAgentModelOverride(options.agentType) ?? process.env.DEFAULT_AI_MODEL ?? 'claude';
    const resolved = resolveModel(modelAlias);

    if (!resolved) {
      throw new Error(`未知的模型：${modelAlias}。可用模型别名：${getAllAliases().join(', ')}`);
    }

    const { provider, model } = resolved;
    if (provider.name === 'claude') {
      yield* this.streamClaude(messages, options, model);
      return;
    }

    yield* this.streamOpenAICompatible(messages, options, provider, model);
  }

  private async callClaude(messages: AIMessage[], options: AIOptions, model: ModelConfig): Promise<AIResponse> {
    const { system, conversation } = splitMessages(messages);
    const response = await this.anthropicClient.messages.create({
      model: model.id,
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0.7,
      system,
      messages: conversation
    });

    const usage = (response.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const costUsd = (inputTokens * model.inputCostPer1M + outputTokens * model.outputCostPer1M) / 1_000_000;
    const result: AIResponse = {
      content: extractAnthropicText(response.content),
      inputTokens,
      outputTokens
    };

    options.onUsage?.({
      model: model.id,
      inputTokens,
      outputTokens,
      costUsd
    });
    agentLogger.aiCall(
      options.agentType ?? 'unknown',
      model.id,
      messages[messages.length - 1]?.content ?? '',
      inputTokens,
      outputTokens,
      false
    );

    return result;
  }

  private async callOpenAICompatible(
    messages: AIMessage[],
    options: AIOptions,
    provider: ProviderConfig,
    model: ModelConfig
  ): Promise<AIResponse> {
    const apiKey = getProviderApiKey(this.config, provider);
    if (!apiKey) {
      throw new Error(`缺少环境变量 ${provider.apiKeyEnv}（provider: ${provider.name}）`);
    }

    const timeoutMs = model.timeoutMs ?? parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '45000', 10);
    const url = `${provider.baseUrl}${getRequestPath(provider)}`;
    const startedAt = Date.now();

    const response = await fetchWithTimeout(
      this.fetcher,
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...provider.requestHeaders
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2000,
          stream: false
        })
      },
      timeoutMs
    );

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (provider.name === 'minimax' && data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0 && !data.choices) {
      throw new Error(`${provider.name} API 错误：${data.base_resp.status_msg || JSON.stringify(data).slice(0, 200)}`);
    }

    if (!response.ok || !data.choices) {
      throw new Error(`${provider.name} API 错误：${JSON.stringify(data).slice(0, 200)}`);
    }

    let rawContent = data.choices[0]?.message?.content ?? '';
    if (provider.stripThinkBlocks) {
      rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>\n?/g, '').trim();
    }
    const content = rawContent;
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const costUsd = (inputTokens * model.inputCostPer1M + outputTokens * model.outputCostPer1M) / 1_000_000;

    console.log(
      JSON.stringify({
        type: 'AI_TIMING',
        provider: provider.name,
        model: model.id,
        total_ms: Date.now() - startedAt,
        tokens_in: inputTokens,
        tokens_out: outputTokens,
        ts: new Date().toISOString()
      })
    );

    options.onUsage?.({
      model: model.id,
      inputTokens,
      outputTokens,
      costUsd
    });
    agentLogger.aiCall(
      options.agentType ?? 'unknown',
      model.id,
      messages[messages.length - 1]?.content ?? '',
      inputTokens,
      outputTokens,
      false
    );

    return { content, inputTokens, outputTokens };
  }

  private async *streamClaude(messages: AIMessage[], options: AIOptions, model: ModelConfig): AsyncGenerator<string> {
    const { system, conversation } = splitMessages(messages);
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model.id,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        system,
        messages: conversation
      })
    });

    yield* streamSseResponse(response);
  }

  private async *streamOpenAICompatible(
    messages: AIMessage[],
    options: AIOptions,
    provider: ProviderConfig,
    model: ModelConfig
  ): AsyncGenerator<string> {
    const apiKey = getProviderApiKey(this.config, provider);
    if (!apiKey) {
      throw new Error(`缺少环境变量 ${provider.apiKeyEnv}（provider: ${provider.name}）`);
    }

    const timeoutMs = model.timeoutMs ?? parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '45000', 10);
    const response = await fetchWithTimeout(
      this.fetcher,
      `${provider.baseUrl}${getRequestPath(provider)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...provider.requestHeaders
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2000,
          stream: true
        })
      },
      timeoutMs
    );

    yield* streamSseResponse(response);
  }
}
