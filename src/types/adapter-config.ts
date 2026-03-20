// 共享的 Adapter 配置类型，客户端和服务端都可导入
export type WorkspaceAdapterConfig = {
  wecom?: {
    botId?: string;
    botSecret?: string;
    mode?: 'bot' | 'webhook';
  };
  ai?: {
    defaultModel?: string;
    anthropicApiKey?: string;
    zhipuApiKey?: string;
    deepseekApiKey?: string;
    arkApiKey?: string;
    minimaxApiKey?: string;
  };
};
