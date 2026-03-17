import { registry } from '@/adapters/registry';

export async function POST(request: Request) {
  const body = (await request.json()) as { webhook_url?: string };
  if (!body.webhook_url) {
    return Response.json({ success: false, error: 'Webhook URL 必填' }, { status: 400 });
  }

  try {
    await registry.getIM().sendMarkdown(body.webhook_url, 'GW-PM 配置测试消息：如果你看到这条消息，说明企业微信绑定成功。');
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : '发送失败' }, { status: 200 });
  }
}
