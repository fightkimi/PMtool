import { AIModelAdapter } from '@/adapters/ai/AIModelAdapter';
import { GitHubAdapter } from '@/adapters/github/GitHubAdapter';
import { TencentDocAdapter } from '@/adapters/tencentdoc/TencentDocAdapter';
import type { AdapterConfig, AIAdapter, CodeAdapter, DocAdapter, IMAdapter } from '@/adapters/types';
import { WeComAdapter } from '@/adapters/wecom/WeComAdapter';

export class AdapterRegistry {
  private im: IMAdapter;
  private doc: DocAdapter;
  private ai: AIAdapter;
  private code?: CodeAdapter;

  constructor(config: AdapterConfig) {
    this.im = new WeComAdapter(config.wecom ?? {});
    this.doc = new TencentDocAdapter(config.tencentdoc ?? {});
    this.ai = new AIModelAdapter(config.ai ?? {});
    this.code = config.code?.provider === 'github' && config.code.token ? new GitHubAdapter(config.code.token) : undefined;
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
}

export const registry = new AdapterRegistry({
  wecom: {
    corpId: process.env.WECOM_CORP_ID,
    agentId: process.env.WECOM_AGENT_ID,
    agentSecret: process.env.WECOM_AGENT_SECRET,
    botToken: process.env.WECOM_BOT_TOKEN,
    botAesKey: process.env.WECOM_BOT_AESKEY
  },
  tencentdoc: {
    appId: process.env.TENCENT_DOC_APP_ID,
    appSecret: process.env.TENCENT_DOC_APP_SECRET
  },
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY
  },
  code: {
    provider: 'github',
    token: process.env.GITHUB_TOKEN
  }
});
