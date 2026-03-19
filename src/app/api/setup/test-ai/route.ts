import { registry } from '@/adapters/registry';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { model?: string };
  const model = body.model?.trim() || process.env.DEFAULT_AI_MODEL || 'claude';
  const startedAt = Date.now();

  try {
    await registry.getAI().chat(
      [{ role: 'user', content: '请回复“AI 测试成功”。' }],
      { model, temperature: 0, maxTokens: 32, agentType: 'setup_test' }
    );

    return Response.json({ success: true, model, latencyMs: Date.now() - startedAt });
  } catch (error) {
    return Response.json(
      {
        success: false,
        model,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'AI 调用失败'
      },
      { status: 200 }
    );
  }
}
