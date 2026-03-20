import { randomUUID } from 'node:crypto';
import menXiaAgent from '@/agents/menxia/MenXiaAgent';
import shangShuAgent from '@/agents/shangshu/ShangShuAgent';
import zhongShuAgent from '@/agents/zhongshu/ZhongShuAgent';
import zhongshuiAgent from '@/agents/zhongshui/ZhongshuiAgent';
import { parse as parseIntent } from '@/adapters/wecom/IntentParser';
import { registry } from '@/adapters/registry';
import type { AgentMessage } from '@/agents/base/types';
import { getProjectById } from '@/lib/queries/projects';

type RunTestPayload = {
  message?: string;
  mode?: 'smoke' | 'full';
  projectId?: string;
};

type StreamEvent = {
  status: 'success' | 'warning' | 'error';
  label: string;
  detail: string;
  elapsedMs: number;
  raw?: unknown;
};

const encoder = new TextEncoder();

function sseChunk(data: StreamEvent | { done: true; totalMs: number }) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function createMessage(projectId: string, workspaceId: string, text: string): AgentMessage {
  return {
    id: randomUUID(),
    from: 'zhongshui',
    to: 'zhongshui',
    type: 'request',
    payload: {
      intent: parseIntent(text).intent,
      params: { text },
      project_id: projectId
    },
    context: {
      workspace_id: workspaceId,
      project_id: projectId,
      job_id: randomUUID(),
      trace_ids: []
    },
    priority: 2,
    created_at: new Date().toISOString()
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RunTestPayload;
  if (!body.message?.trim() || !body.projectId) {
    return Response.json({ error: 'message 和 projectId 必填' }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);
  if (!project) {
    return Response.json({ error: '项目不存在' }, { status: 404 });
  }

  const mode = body.mode ?? 'smoke';

  // 确保 AI adapter 已加载 DB 中的配置（API Key、默认模型等）
  await registry.ensureDbConfig();

  const stream = new ReadableStream({
    start(controller) {
      const startedAt = Date.now();

      const push = (event: Omit<StreamEvent, 'elapsedMs'> & { raw?: unknown }) => {
        controller.enqueue(
          sseChunk({
            ...event,
            elapsedMs: Date.now() - startedAt
          })
        );
      };

      void (async () => {
        try {
          const parsed = parseIntent(body.message!.trim());
          push({ status: 'success', label: '意图识别', detail: parsed.intent, raw: parsed });

          const zhongshuiResult = await zhongshuiAgent.run(
            createMessage(project.id, project.workspaceId, body.message!.trim())
          );

          push({
            status: 'success',
            label: '中枢路由',
            detail: `转发到 ${zhongshuiResult.to}`
          });

          if (zhongshuiResult.to !== 'zhongshu') {
            controller.enqueue(sseChunk({ done: true, totalMs: Date.now() - startedAt }));
            controller.close();
            return;
          }

          const zhongshuResult = await zhongShuAgent.run(zhongshuiResult);
          const modeLabel = zhongshuResult.payload.mode === 'pipeline' ? '实例化排期' : '拆解出';
          const itemCount = Array.isArray((zhongshuResult.payload as Record<string, unknown>).ids)
            ? ((zhongshuResult.payload as Record<string, unknown>).ids as unknown[]).length
            : 0;
          push({
            status: 'success',
            label: '中书省',
            detail: `${modeLabel} ${itemCount} 个${zhongshuResult.payload.mode === 'pipeline' ? '阶段' : '任务'}`,
            raw: zhongshuResult.payload
          });

          if (mode === 'smoke' || zhongshuResult.to !== 'menxia') {
            controller.enqueue(sseChunk({ done: true, totalMs: Date.now() - startedAt }));
            controller.close();
            return;
          }

          const menxiaResult = await menXiaAgent.run(zhongshuResult);
          if (menxiaResult.type === 'veto') {
            const issues = Array.isArray((menxiaResult.payload as Record<string, unknown>).issues)
              ? (((menxiaResult.payload as Record<string, unknown>).issues as string[])[0] ?? '审核未通过')
              : '审核未通过';
            push({
              status: 'warning',
              label: '门下省',
              detail: `veto（${issues}）`,
              raw: menxiaResult.payload
            });
            controller.enqueue(sseChunk({ done: true, totalMs: Date.now() - startedAt }));
            controller.close();
            return;
          }

          push({
            status: 'success',
            label: '门下省',
            detail: '审核通过',
            raw: menxiaResult.payload
          });

          if (menxiaResult.to === 'shangshu') {
            const shangshuResult = await shangShuAgent.run(menxiaResult);
            push({
              status: 'success',
              label: '尚书省',
              detail: `已分配 ${(shangshuResult.payload as Record<string, unknown>).assigned_count ?? 0} 个事项`,
              raw: shangshuResult.payload
            });
          }

          controller.enqueue(sseChunk({ done: true, totalMs: Date.now() - startedAt }));
          controller.close();
        } catch (error) {
          push({
            status: 'error',
            label: '执行失败',
            detail: error instanceof Error ? error.message : '未知错误'
          });
          controller.enqueue(sseChunk({ done: true, totalMs: Date.now() - startedAt }));
          controller.close();
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
