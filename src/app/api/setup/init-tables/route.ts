export async function POST(request: Request) {
  const body = (await request.json()) as { root_id?: string; project_name?: string };
  if (!body.root_id || !body.project_name) {
    return Response.json({ error: 'root_id 和 project_name 必填' }, { status: 400 });
  }

  return Response.json(
    {
      error:
        'Webhook 模式不支持自动创建智能表格，请在企业微信智能表格工作表中开启“接收外部数据”并复制各表 Webhook 地址。'
    },
    { status: 400 }
  );
}
