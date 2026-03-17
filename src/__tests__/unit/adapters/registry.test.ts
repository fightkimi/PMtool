import { describe, expect, it, vi } from 'vitest';

const wecomInstance = { kind: 'im' };
const docInstance = { kind: 'doc' };
const aiInstance = { kind: 'ai' };
const githubInstance = { kind: 'code' };

vi.mock('@/adapters/wecom/WeComAdapter', () => ({
  WeComAdapter: vi.fn().mockImplementation(() => wecomInstance)
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
      wecom: { botToken: 'bot' },
      tencentdoc: { appId: 'app', appSecret: 'secret' },
      ai: { anthropicApiKey: 'key' },
      code: { provider: 'github', token: 'gh-token' }
    });

    expect(registry.getIM()).toBe(wecomInstance);
    expect(registry.getDoc()).toBe(docInstance);
    expect(registry.getAI()).toBe(aiInstance);
    expect(registry.getCode()).toBe(githubInstance);
  });

  it('returns undefined code adapter without token', async () => {
    const { AdapterRegistry } = await import('@/adapters/registry');
    const registry = new AdapterRegistry({
      code: { provider: 'github' }
    });

    expect(registry.getCode()).toBeUndefined();
  });
});
