import { describe, expect, it, vi } from 'vitest';

const wecomInstance = { kind: 'im' };
const wecomWebhookInstance = { kind: 'im-webhook' };
const docInstance = { kind: 'doc' };
const aiInstance = { kind: 'ai' };
const githubInstance = { kind: 'code' };

vi.mock('@/adapters/wecom/WeComBotAdapter', () => ({
  WeComBotAdapter: vi.fn().mockImplementation(() => wecomInstance)
}));

vi.mock('@/adapters/wecom/WeComWebhookAdapter', () => ({
  WeComWebhookAdapter: vi.fn().mockImplementation(() => wecomWebhookInstance)
}));

vi.mock('@/adapters/tencentdoc/TencentDocAdapter', () => ({
  TencentDocAdapter: vi.fn().mockImplementation(() => docInstance)
}));

vi.mock('@/adapters/ai/AIModelAdapter', () => ({
  AIModelAdapter: vi.fn().mockImplementation(() => aiInstance)
}));

vi.mock('@/adapters/github/GitHubAdapter', () => ({
  GitHubAdapter: vi.fn().mockImplementation(() => githubInstance)
}));

describe('AdapterRegistry', () => {
  it('returns instantiated adapters from config', async () => {
    const { AdapterRegistry } = await import('@/adapters/registry');
    const registry = new AdapterRegistry({
      wecom: { mode: 'bot', botId: 'bot-id', botSecret: 'bot-secret' },
      tencentdoc: { appId: 'app', appSecret: 'secret' },
      ai: { anthropicApiKey: 'key' },
      code: { provider: 'github', token: 'gh-token' }
    });

    expect(registry.getIM()).toBe(wecomInstance);
    expect(registry.getDoc()).toBe(docInstance);
    expect(registry.getAI()).toBe(aiInstance);
    expect(registry.getCode()).toBe(githubInstance);
  });

  it('uses webhook adapter when mode is webhook', async () => {
    const { AdapterRegistry } = await import('@/adapters/registry');
    const registry = new AdapterRegistry({
      wecom: { mode: 'webhook', botToken: 'bot' }
    });

    expect(registry.getIM()).toBe(wecomWebhookInstance);
  });

  it('returns undefined code adapter without token', async () => {
    const { AdapterRegistry } = await import('@/adapters/registry');
    const registry = new AdapterRegistry({
      code: { provider: 'github' }
    });

    expect(registry.getCode()).toBeUndefined();
  });
});
