import { randomUUID } from 'node:crypto';
import capacityAgent from '@/agents/capacity/CapacityAgent';
import libuBingAgent from '@/agents/libu_bing/LibuBingAgent';
import libuLi2Agent from '@/agents/libu_li2/LibuLi2Agent';
import { registry } from '@/adapters/registry';
import { ensureDefaultWorkspace } from '@/app/api/setup/_shared';
import { getProjectById } from '@/lib/queries/projects';

type TriggerPayload = {
  type?: 'daily_scan' | 'weekly_report' | 'capacity_snapshot';
  projectId?: string;
};

type TriggerDeps = {
  ensureRegistryConfig?: () => Promise<void>;
  ensureWorkspace?: typeof ensureDefaultWorkspace;
  getProject?: typeof getProjectById;
  runCapacity?: typeof capacityAgent.run;
  runDailyScan?: typeof libuBingAgent.run;
  runWeeklyReport?: typeof libuLi2Agent.run;
};

function createContext(workspaceId: string, projectId?: string) {
  return {
    workspace_id: workspaceId,
    project_id: projectId,
    job_id: randomUUID(),
    trace_ids: []
  };
}

export function createAgentTriggerHandler(deps: TriggerDeps = {}) {
  const ensureRegistryConfigFn = deps.ensureRegistryConfig ?? (() => registry.ensureDbConfig());
  const ensureWorkspaceFn = deps.ensureWorkspace ?? ensureDefaultWorkspace;
  const getProjectFn = deps.getProject ?? getProjectById;
  const runCapacityFn = deps.runCapacity ?? ((message) => capacityAgent.run(message));
  const runDailyScanFn = deps.runDailyScan ?? ((message) => libuBingAgent.run(message));
  const runWeeklyReportFn = deps.runWeeklyReport ?? ((message) => libuLi2Agent.run(message));

  return async function POST(request: Request) {
    const body = (await request.json()) as TriggerPayload;
    if (!body.type) {
      return Response.json({ success: false, error: '触发类型必填' }, { status: 400 });
    }

    await ensureRegistryConfigFn();

    try {
      if (body.type === 'capacity_snapshot') {
        const workspaceId = body.projectId
          ? (await getProjectFn(body.projectId))?.workspaceId
          : (await ensureWorkspaceFn()).id;
        if (!workspaceId) {
          return Response.json({ success: false, error: '无法确定 workspace' }, { status: 400 });
        }

        const result = await runCapacityFn({
          id: randomUUID(),
          from: 'zhongshui',
          to: 'capacity',
          type: 'request',
          payload: { workspace_id: workspaceId },
          context: createContext(workspaceId, body.projectId),
          priority: 2,
          created_at: new Date().toISOString()
        });

        return Response.json({ success: true, agentType: 'capacity', result });
      }

      if (!body.projectId) {
        return Response.json({ success: false, error: 'projectId 必填' }, { status: 400 });
      }

      const project = await getProjectFn(body.projectId);
      if (!project) {
        return Response.json({ success: false, error: '项目不存在' }, { status: 404 });
      }

      if (body.type === 'daily_scan') {
        const result = await runDailyScanFn({
          id: randomUUID(),
          from: 'zhongshui',
          to: 'libu_bing',
          type: 'request',
          payload: { project_id: project.id, type: 'daily_scan' },
          context: createContext(project.workspaceId, project.id),
          priority: 1,
          created_at: new Date().toISOString()
        });

        return Response.json({ success: true, agentType: 'libu_bing', result });
      }

      const result = await runWeeklyReportFn({
        id: randomUUID(),
        from: 'zhongshui',
        to: 'libu_li2',
        type: 'request',
        payload: { project_id: project.id, type: 'weekly_report' },
        context: createContext(project.workspaceId, project.id),
        priority: 2,
        created_at: new Date().toISOString()
      });

      return Response.json({ success: true, agentType: 'libu_li2', result });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : '触发失败'
        },
        { status: 200 }
      );
    }
  };
}

export const POST = createAgentTriggerHandler();
