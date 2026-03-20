import { registry } from '@/adapters/registry';
import { parseAdapterConfig } from '@/app/api/setup/_dashboard';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';

type TestAiPayload = {
  model?: string;
};

type TestAiDeps = {
  ensureRegistryConfig?: () => Promise<void>;
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  parseConfig?: typeof parseAdapterConfig;
  chat?: (model: string) => Promise<void>;
  now?: () => number;
};

export function createSetupAiTestHandler(deps: TestAiDeps = {}) {
  const ensureRegistryConfigFn = deps.ensureRegistryConfig ?? (() => registry.ensureDbConfig());
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const parseConfigFn = deps.parseConfig ?? parseAdapterConfig;
  const chatFn =
    deps.chat ??
    ((model: string) =>
      registry.getAI().chat(
        [{ role: 'user', content: '请回复“AI 测试成功”。' }],
        { model, temperature: 0, maxTokens: 32, agentType: 'setup_test' }
      ));
  const nowFn = deps.now ?? Date.now;

  return async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as TestAiPayload;
    await ensureRegistryConfigFn();

    const workspace = await ensureWorkspaceFn();
    const config = parseConfigFn(workspace.adapterConfig as Record<string, unknown>);
    const model = body.model?.trim() || config.ai?.defaultModel?.trim() || process.env.DEFAULT_AI_MODEL || 'claude';
    const startedAt = nowFn();

    try {
      await chatFn(model);
      return Response.json({ success: true, model, latencyMs: nowFn() - startedAt });
    } catch (error) {
      return Response.json(
        {
          success: false,
          model,
          latencyMs: nowFn() - startedAt,
          error: error instanceof Error ? error.message : 'AI 调用失败'
        },
        { status: 200 }
      );
    }
  };
}

export const POST = createSetupAiTestHandler();
