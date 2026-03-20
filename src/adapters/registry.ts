import { AIModelAdapter } from '@/adapters/ai/AIModelAdapter';
import { GiteeAdapter } from '@/adapters/github/GiteeAdapter';
import { GitHubAdapter } from '@/adapters/github/GitHubAdapter';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';
import type { AdapterConfig, AIAdapter, CodeAdapter, DocAdapter, IMAdapter } from '@/adapters/types';
import { WeComBotAdapter } from '@/adapters/wecom/WeComBotAdapter';
import { WeComWebhookAdapter } from '@/adapters/wecom/WeComWebhookAdapter';
export type { WorkspaceAdapterConfig } from '@/types/adapter-config';
import type { WorkspaceAdapterConfig } from '@/types/adapter-config';

function buildEnvConfig(): AdapterConfig {
  return {
    wecom: {
      corpId: process.env.WECOM_CORP_ID,
      agentId: process.env.WECOM_AGENT_ID,
      agentSecret: process.env.WECOM_AGENT_SECRET,
      botToken: process.env.WECOM_BOT_TOKEN,
      botAesKey: process.env.WECOM_BOT_AESKEY,
      botId: process.env.WECOM_BOT_ID,
      botSecret: process.env.WECOM_BOT_SECRET,
      mode: (process.env.WECOM_MODE as 'bot' | 'webhook' | undefined) ?? 'bot'
    },
    tencentdoc: {
      webhookUrls: {}
    },
    ai: {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      minimaxApiKey: process.env.MINIMAX_API_KEY,
      apiKeys: {
        ...(process.env.ZHIPU_API_KEY ? { zhipu: process.env.ZHIPU_API_KEY } : {}),
        ...(process.env.ARK_API_KEY ? { doubao: process.env.ARK_API_KEY } : {})
      }
    },
    code: {
      provider: (process.env.CODE_PROVIDER as 'github' | 'gitee' | undefined) ?? 'github',
      token: process.env.CODE_PROVIDER === 'gitee' ? process.env.GITEE_TOKEN : process.env.GITHUB_TOKEN
    }
  };
}

// 将 DB 中的 WorkspaceAdapterConfig 合并到 env 配置上（DB 优先）
function mergeDbConfig(envConfig: AdapterConfig, dbConfig: WorkspaceAdapterConfig): AdapterConfig {
  const merged = { ...envConfig };

  if (dbConfig.wecom) {
    merged.wecom = {
      ...merged.wecom,
      ...(dbConfig.wecom.botId ? { botId: dbConfig.wecom.botId } : {}),
      ...(dbConfig.wecom.botSecret ? { botSecret: dbConfig.wecom.botSecret } : {}),
      ...(dbConfig.wecom.mode ? { mode: dbConfig.wecom.mode } : {})
    };
  }

  if (dbConfig.ai) {
    const dbAi = dbConfig.ai;
    merged.ai = {
      ...merged.ai,
      ...(dbAi.defaultModel ? { defaultModel: dbAi.defaultModel } : {}),
      ...(dbAi.anthropicApiKey ? { anthropicApiKey: dbAi.anthropicApiKey } : {}),
      ...(dbAi.deepseekApiKey ? { deepseekApiKey: dbAi.deepseekApiKey } : {}),
      ...(dbAi.minimaxApiKey ? { minimaxApiKey: dbAi.minimaxApiKey } : {})
    };

    // apiKeys 合并
    const apiKeys = { ...(merged.ai?.apiKeys ?? {}) };
    if (dbAi.zhipuApiKey) {
      apiKeys.zhipu = dbAi.zhipuApiKey;
    }
    if (dbAi.arkApiKey) {
      apiKeys.doubao = dbAi.arkApiKey;
    }
    merged.ai = { ...merged.ai, apiKeys };
  }

  return merged;
}

export class AdapterRegistry {
  private im: IMAdapter;
  private doc: DocAdapter;
  private ai: AIAdapter;
  private code?: CodeAdapter;
  private dbConfigLoaded = false;

  constructor(config: AdapterConfig) {
    const wecomConfig = config.wecom ?? {};
    const mode = wecomConfig.mode ?? 'bot';
    this.im = mode === 'webhook' ? new WeComWebhookAdapter(wecomConfig) : new WeComBotAdapter(wecomConfig);
    this.doc = new TencentDocAdapter(config.tencentdoc ?? {});
    this.ai = new AIModelAdapter(config.ai ?? {});
    this.code =
      config.code?.provider === 'github' && config.code.token
        ? new GitHubAdapter(config.code.token)
        : config.code?.provider === 'gitee' && config.code.token
          ? new GiteeAdapter({ token: config.code.token })
          : undefined;
  }

  // 从 DB 加载 workspace 配置（首次调用后缓存，避免重复查询）
  async ensureDbConfig(): Promise<void> {
    if (this.dbConfigLoaded) return;
    try {
      const { ensureDefaultWorkspace } = await import('@/app/api/setup/_shared');
      const { parseAdapterConfig } = await import('@/app/api/setup/_dashboard');
      const workspace = await ensureDefaultWorkspace();
      const dbConfig = parseAdapterConfig(workspace.adapterConfig as Record<string, unknown>);
      this.reloadFromConfig(dbConfig, { rebuildIM: true });
      this.dbConfigLoaded = true;
    } catch {
      // DB 不可用时静默失败，使用 env 配置
    }
  }

  getIM(): IMAdapter {
    return this.im;
  }

  getDoc(): DocAdapter {
    return this.doc;
  }

  getAI(): AIAdapter {
    return this.ai;
  }

  getCode(): CodeAdapter | undefined {
    return this.code;
  }

  // 从 DB 配置热更新 adapters
  reloadFromConfig(dbConfig: WorkspaceAdapterConfig, options?: { rebuildIM?: boolean }): void {
    const envConfig = buildEnvConfig();
    const merged = mergeDbConfig(envConfig, dbConfig);
    this.ai = new AIModelAdapter(merged.ai ?? {});

    // IM adapter 默认不重建（避免断开活跃的 WebSocket），仅在首次加载时重建
    if (options?.rebuildIM) {
      const wecomConfig = merged.wecom ?? {};
      const mode = wecomConfig.mode ?? 'bot';
      this.im = mode === 'webhook' ? new WeComWebhookAdapter(wecomConfig) : new WeComBotAdapter(wecomConfig);
    }
  }
}

export const registry = new AdapterRegistry(buildEnvConfig());
