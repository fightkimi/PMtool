export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: ModelConfig[];
  requestHeaders?: Record<string, string>;
  chatPath?: string;
  stripThinkBlocks?: boolean;
}

export interface ModelConfig {
  id: string;
  alias: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  timeoutMs?: number;
}

function createBuiltinProviders(): ProviderConfig[] {
  return [
    {
      name: 'doubao',
      baseUrl: process.env.ARK_API_BASE ?? 'https://ark.cn-beijing.volces.com/api/v3',
      apiKeyEnv: 'ARK_API_KEY',
      models: [
        {
          id: process.env.DOUBAO_MODEL_FAST ?? 'doubao-seed-1-6-flash-250828',
          alias: 'doubao-fast',
          inputCostPer1M: 0,
          outputCostPer1M: 0
        },
        {
          id: process.env.DOUBAO_MODEL ?? 'doubao-seed-1-6-251015',
          alias: 'doubao',
          inputCostPer1M: 0,
          outputCostPer1M: 0
        }
      ]
    },
    {
      name: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyEnv: 'ZHIPU_API_KEY',
      models: [
        { id: 'glm-4-flash', alias: 'glm-flash', inputCostPer1M: 0.1, outputCostPer1M: 0.1 },
        { id: 'glm-4-air', alias: 'glm-air', inputCostPer1M: 1.0, outputCostPer1M: 1.0 },
        { id: 'glm-4', alias: 'glm', inputCostPer1M: 2.0, outputCostPer1M: 2.0 },
        { id: 'glm-5', alias: 'glm-5', inputCostPer1M: 6.0, outputCostPer1M: 6.0 }
      ]
    },
    {
      name: 'minimax',
      baseUrl: process.env.MINIMAX_API_BASE ?? 'https://api.minimax.io/v1',
      apiKeyEnv: 'MINIMAX_API_KEY',
      chatPath: '/text/chatcompletion_v2',
      stripThinkBlocks: true,
      models: [
        { id: 'MiniMax-M2.1', alias: 'minimax-fast', inputCostPer1M: 0.2, outputCostPer1M: 1.1, timeoutMs: 45000 },
        { id: 'MiniMax-M2.5', alias: 'minimax', inputCostPer1M: 0.8, outputCostPer1M: 2.4, timeoutMs: 60000 }
      ]
    },
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: [
        { id: 'deepseek-chat', alias: 'deepseek', inputCostPer1M: 0.14, outputCostPer1M: 0.28 }
      ]
    },
    {
      name: 'deepseek-reasoner',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      stripThinkBlocks: true,
      models: [
        { id: 'deepseek-reasoner', alias: 'deepseek-r1', inputCostPer1M: 0.55, outputCostPer1M: 2.19 }
      ]
    },
    {
      name: 'claude',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: [{ id: 'claude-sonnet-4-6', alias: 'claude', inputCostPer1M: 3.0, outputCostPer1M: 15.0 }]
    }
  ];
}

export const BUILTIN_PROVIDERS: ProviderConfig[] = createBuiltinProviders();

function getProviders(): ProviderConfig[] {
  return createBuiltinProviders();
}

// 前缀到 provider name 的映射，用于识别自定义模型 ID
const MODEL_PREFIX_MAP: Record<string, string> = {
  'doubao-': 'doubao',
  'deepseek-': 'deepseek',
  'glm-': 'zhipu',
  'MiniMax-': 'minimax',
  'claude-': 'claude',
};

export function resolveModel(aliasOrId: string): { provider: ProviderConfig; model: ModelConfig } | null {
  const providers = getProviders();

  // 精确匹配 alias 或 id
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.alias === aliasOrId || model.id === aliasOrId) {
        return { provider, model };
      }
    }
  }

  // 前缀匹配：支持自定义模型 ID（如 Ark 平台的 doubao-seed-2-0-pro-260215）
  for (const [prefix, providerName] of Object.entries(MODEL_PREFIX_MAP)) {
    if (aliasOrId.startsWith(prefix)) {
      const provider = providers.find((p) => p.name === providerName);
      if (provider) {
        return {
          provider,
          model: { id: aliasOrId, alias: aliasOrId, inputCostPer1M: 0, outputCostPer1M: 0 }
        };
      }
    }
  }

  return null;
}

export function getAllAliases(): string[] {
  return getProviders().flatMap((provider) => provider.models.map((model) => model.alias));
}
