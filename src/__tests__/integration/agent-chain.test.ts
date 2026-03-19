import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIAdapter, DocAdapter, IMAdapter } from '@/adapters/types';
import type { AgentMessage } from '@/agents/base/types';

const TEST_DATABASE_URL = 'postgresql://gwpm:gwpm_test@localhost:5433/gwpm_test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');

vi.unmock('@/lib/db');

let dbModule: typeof import('@/lib/db');
let schemaModule: typeof import('@/lib/schema');
let syncModule: typeof import('@/lib/sync/tableSync');
let zhongshuModule: typeof import('@/agents/zhongshu/ZhongShuAgent');
let pipelineInstantiatorModule: typeof import('@/agents/zhongshu/PipelineInstantiator');
let cpmModule: typeof import('@/agents/libu_gong/CPMEngine');
let menxiaModule: typeof import('@/agents/menxia/MenXiaAgent');
let shangshuModule: typeof import('@/agents/shangshu/ShangShuAgent');
let capacityModule: typeof import('@/agents/capacity/CapacityAgent');
let integrationReady = false;

function buildMessage(
  to: AgentMessage['to'],
  payload: Record<string, unknown>,
  context: AgentMessage['context'],
  type: AgentMessage['type'] = 'request'
): AgentMessage {
  return {
    id: randomUUID(),
    from: 'zhongshui',
    to,
    type,
    payload,
    context,
    priority: 2,
    created_at: new Date().toISOString()
  };
}

function createRegistry(aiContent: string, im?: IMAdapter) {
  const imAdapter: IMAdapter =
    im ??
    {
      sendMessage: vi.fn(),
      sendMarkdown: vi.fn(),
      sendCard: vi.fn(),
      sendDM: vi.fn(),
      parseIncoming: vi.fn(),
      getGroupMembers: vi.fn()
    };
  const aiAdapter: AIAdapter = {
    chat: vi.fn().mockResolvedValue({
      content: aiContent,
      inputTokens: 10,
      outputTokens: 20
    }),
    stream: vi.fn()
  };

  return {
    registry: {
      getIM: () => imAdapter,
      getAI: () => aiAdapter
    },
    imAdapter,
    aiAdapter
  };
}

async function insertWorkspaceAndProject(options?: {
  taskTableWebhook?: string;
  pipelineTableWebhook?: string;
  riskTableWebhook?: string;
  wecomBotWebhook?: string;
  pmId?: string | null;
}) {
  const workspaceRows = await dbModule.db
    .insert(schemaModule.workspaces)
    .values({
      name: 'Integration Workspace',
      slug: `integration-${randomUUID().slice(0, 8)}`,
      plan: 'free',
      adapterConfig: {}
    })
    .returning();
  const workspace = workspaceRows[0]!;

  const projectRows = await dbModule.db
    .insert(schemaModule.projects)
    .values({
      workspaceId: workspace.id,
      name: 'Integration Project',
      type: 'custom',
      status: 'active',
      pmId: options?.pmId ?? null,
      taskTableWebhook: options?.taskTableWebhook ?? null,
      pipelineTableWebhook: options?.pipelineTableWebhook ?? null,
      riskTableWebhook: options?.riskTableWebhook ?? null,
      wecomBotWebhook: options?.wecomBotWebhook ?? null
    })
    .returning();

  return {
    workspace: workspaceRows[0]!,
    project: projectRows[0]!
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
  Reflect.set(process.env, 'NODE_ENV', 'test');

  vi.unmock('@/lib/db');
  vi.resetModules();

  try {
    execSync('npm run db:migrate', {
      cwd: workspaceRoot,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe'
    });

    dbModule = await import('@/lib/db');
    schemaModule = await import('@/lib/schema');
    syncModule = await import('@/lib/sync/tableSync');
    zhongshuModule = await import('@/agents/zhongshu/ZhongShuAgent');
    pipelineInstantiatorModule = await import('@/agents/zhongshu/PipelineInstantiator');
    cpmModule = await import('@/agents/libu_gong/CPMEngine');
    menxiaModule = await import('@/agents/menxia/MenXiaAgent');
    shangshuModule = await import('@/agents/shangshu/ShangShuAgent');
    capacityModule = await import('@/agents/capacity/CapacityAgent');
    integrationReady = true;
  } catch (error) {
    integrationReady = false;
    console.warn('Skipping integration setup because test database is unavailable.', error);
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external HTTP call')));
  if (!integrationReady) {
    return;
  }
  await dbModule.db.execute(sql.raw('TRUNCATE TABLE "workspaces" CASCADE'));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (dbModule) {
    await dbModule.closeDbConnection();
  }
});

describe('agent integration chain', () => {
  it('persists parsed tasks and routes review to menxia', async () => {
    if (!integrationReady) {
      return;
    }
    const { workspace, project } = await insertWorkspaceAndProject({
      taskTableWebhook: 'task-table-1'
    });
    const { registry } = createRegistry(
      JSON.stringify({
        type: 'task',
        tasks: [
          {
            title: '任务一',
            description: '实现登录',
            acceptance_criteria: ['支持账号密码登录'],
            estimated_hours: 8,
            priority: 'high',
            department: 'libu_gong',
            dependencies: []
          },
          {
            title: '任务二',
            description: '实现菜单',
            acceptance_criteria: ['展示导航菜单'],
            estimated_hours: 6,
            priority: 'medium',
            department: 'libu_li',
            dependencies: []
          },
          {
            title: '任务三',
            description: '实现报表',
            acceptance_criteria: ['支持日报查询'],
            estimated_hours: 10,
            priority: 'medium',
            department: 'libu_hu',
            dependencies: []
          }
        ],
        review_notes: []
      })
    );
    const queue = { enqueue: vi.fn().mockResolvedValue('job-menxia') };
    const docAdapter: DocAdapter = {
      readTable: vi.fn(),
      createRecord: vi
        .fn()
        .mockResolvedValueOnce('row-001')
        .mockResolvedValueOnce('row-002')
        .mockResolvedValueOnce('row-003'),
      updateRecord: vi.fn(),
      batchUpdate: vi.fn(),
      findRecord: vi.fn(),
      createTable: vi.fn()
    };
    const agent = new zhongshuModule.ZhongShuAgent({
      registry,
      queue,
      tableSync: {
        batchSyncTasksToTable: async (_projectId, taskRows) => {
          for (const task of taskRows) {
            await syncModule.syncTaskToTable(task, project, docAdapter);
          }
        }
      }
    });

    await agent.handle(
      buildMessage(
        'zhongshu',
        { project_id: project.id, content: '功能需求：登录、菜单、报表', source: 'text' },
        {
          workspace_id: workspace.id,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        }
      )
    );

    const tasks = await dbModule.db.select().from(schemaModule.tasks).where(eq(schemaModule.tasks.projectId, project.id));
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => Boolean(task.title) && task.estimatedHours != null && task.department != null)).toBe(true);
    expect(docAdapter.createRecord).toHaveBeenCalledTimes(3);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'menxia'
      })
    );
  });

  it('instantiates a pipeline run and computes CPM schedule', async () => {
    if (!integrationReady) {
      return;
    }
    const { workspace, project } = await insertWorkspaceAndProject({
      pipelineTableWebhook: 'pipeline-table-1'
    });
    const pipelineRows = await dbModule.db
      .insert(schemaModule.pipelines)
      .values({
        workspaceId: workspace.id,
        name: 'UI S 集成模板',
        businessType: 'ui',
        complexityTier: 's',
        totalWeeksDefault: 12,
        milestoneAnchors: [],
        historicalVelocities: {},
        isSystemTemplate: true,
        stages: [
          { stage_key: 'A', role_type: 'planner', name: 'A', default_weeks: 1, depends_on: [], deliverables: [], can_parallel: false },
          { stage_key: 'B', role_type: 'ux_designer', name: 'B', default_weeks: 1, depends_on: ['A'], deliverables: [], can_parallel: false },
          { stage_key: 'C', role_type: 'ui_designer', name: 'C', default_weeks: 1, depends_on: ['B'], deliverables: [], can_parallel: false },
          { stage_key: 'D', role_type: 'ui_designer', name: 'D', default_weeks: 1, depends_on: ['C'], deliverables: [], can_parallel: false },
          { stage_key: 'E', role_type: 'animator', name: 'E', default_weeks: 1, depends_on: ['D'], deliverables: [], can_parallel: false },
          { stage_key: 'F', role_type: 'ui_designer', name: 'F', default_weeks: 1, depends_on: ['E'], deliverables: [], can_parallel: false }
        ]
      })
      .returning();
    const pipeline = pipelineRows[0]!;
    const { registry } = createRegistry(
      JSON.stringify({
        type: 'pipeline',
        deliverables: [
          {
            name: '主界面 UI',
            business_type: 'ui',
            complexity_tier: 's',
            notes: 'S 级 UI'
          }
        ],
        review_notes: []
      })
    );
    const queue = { enqueue: vi.fn().mockResolvedValue('job-menxia') };
    const pipelineInstantiator = new pipelineInstantiatorModule.PipelineInstantiator({
      computeCriticalPath: async (runId) => {
        await cpmModule.cpmEngine.computeCriticalPath(runId);
      }
    });
    const agent = new zhongshuModule.ZhongShuAgent({
      registry,
      queue,
      findPipelineTemplate: vi.fn().mockResolvedValue(pipeline),
      pipelineInstantiator
    });

    await agent.handle(
      buildMessage(
        'zhongshu',
        { project_id: project.id, content: 'UI改版需求', source: 'text' },
        {
          workspace_id: workspace.id,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        }
      )
    );

    const runs = await dbModule.db.select().from(schemaModule.pipelineRuns).where(eq(schemaModule.pipelineRuns.projectId, project.id));
    expect(runs).toHaveLength(1);
    const stages = await dbModule.db
      .select()
      .from(schemaModule.pipelineStageInstances)
      .where(eq(schemaModule.pipelineStageInstances.runId, runs[0]!.id));
    expect(stages).toHaveLength(6);
    expect(stages.every((stage) => stage.stageKey && stage.roleType && stage.plannedStart)).toBe(true);
    expect(stages.filter((stage) => Number(stage.floatDays ?? '0') === 0).length).toBeGreaterThan(0);
  });

  it('evaluates and executes a change request end-to-end', async () => {
    if (!integrationReady) {
      return;
    }
    const pmRows = await dbModule.db
      .insert(schemaModule.users)
      .values({
        workspaceId: (
          await dbModule.db
            .insert(schemaModule.workspaces)
            .values({
              name: 'Change Workspace',
              slug: `change-${randomUUID().slice(0, 8)}`,
              plan: 'free',
              adapterConfig: {}
            })
            .returning()
        )[0]!.id,
        name: 'PM',
        email: `${randomUUID()}@gw-pm.local`,
        role: 'pm',
        imUserId: 'pm-im',
        skills: ['pm']
      })
      .returning();
    const pm = pmRows[0]!;
    const projectRows = await dbModule.db
      .insert(schemaModule.projects)
      .values({
        workspaceId: pm.workspaceId,
        name: 'Change Project',
        type: 'custom',
        status: 'active',
        pmId: pm.id,
        wecomBotWebhook: 'https://example.com/group'
      })
      .returning();
    const project = projectRows[0]!;
    const assigneeRows = await dbModule.db
      .insert(schemaModule.users)
      .values({
        workspaceId: pm.workspaceId,
        name: 'UI Owner',
        email: `${randomUUID()}@gw-pm.local`,
        role: 'designer',
        imUserId: 'ui-owner',
        skills: ['ui_designer']
      })
      .returning();
    const assignee = assigneeRows[0]!;
    const pipelineRows = await dbModule.db
      .insert(schemaModule.pipelines)
      .values({
        workspaceId: pm.workspaceId,
        name: 'Change Template',
        businessType: 'ui',
        complexityTier: 's',
        totalWeeksDefault: 4,
        milestoneAnchors: [],
        stages: [],
        historicalVelocities: {},
        isSystemTemplate: false
      })
      .returning();
    const runRows = await dbModule.db
      .insert(schemaModule.pipelineRuns)
      .values({
        pipelineId: pipelineRows[0]!.id,
        projectId: project.id,
        name: 'UI Run',
        complexityTier: 's',
        status: 'active'
      })
      .returning();
    const run = runRows[0]!;
    const nextMonday = new Date('2026-03-23T00:00:00.000Z');
    const nextFriday = new Date('2026-03-27T00:00:00.000Z');
    await dbModule.db.insert(schemaModule.pipelineStageInstances).values([
      {
        runId: run.id,
        stageKey: 'A',
        roleType: 'ui_designer',
        plannedStart: new Date('2026-03-20T00:00:00.000Z'),
        plannedEnd: nextMonday,
        dependsOn: [],
        estimatedHours: 24,
        status: 'active'
      },
      {
        runId: run.id,
        stageKey: 'B',
        roleType: 'ui_designer',
        assigneeId: assignee.id,
        plannedStart: nextMonday,
        plannedEnd: nextFriday,
        dependsOn: ['A'],
        estimatedHours: 24,
        status: 'pending'
      }
    ]);
    const changeRows = await dbModule.db
      .insert(schemaModule.changeRequests)
      .values({
        projectId: project.id,
        source: 'requirement',
        title: 'UI阶段延期5天',
        description: 'UI阶段延期5天',
        status: 'draft',
        affectedRunIds: [run.id]
      })
      .returning();
    const changeRequest = changeRows[0]!;
    const imAdapter: IMAdapter = {
      sendMessage: vi.fn(),
      sendMarkdown: vi.fn(),
      sendCard: vi.fn(),
      sendDM: vi.fn(),
      parseIncoming: vi.fn(),
      getGroupMembers: vi.fn()
    };
    const { registry } = createRegistry(
      JSON.stringify({
        affected_summary: '影响 2 个阶段',
        days_impact: 5,
        risks: ['UI资源被压缩'],
        affected_task_ids: []
      }),
      imAdapter
    );

    const menxia = new menxiaModule.MenXiaAgent({
      registry
    });
    await menxia.handle(
      buildMessage(
        'menxia',
        { change_request_id: changeRequest.id },
        {
          workspace_id: pm.workspaceId,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        }
      )
    );

    const evaluatingRows = await dbModule.db
      .select()
      .from(schemaModule.changeRequests)
      .where(eq(schemaModule.changeRequests.id, changeRequest.id));
    expect(evaluatingRows[0]!.scheduleImpactDays).toBe(5);
    expect(evaluatingRows[0]!.status).toBe('evaluating');
    expect(imAdapter.sendCard).toHaveBeenCalled();

    const shangshu = new shangshuModule.ShangShuAgent({
      registry
    });
    await shangshu.handle(
      buildMessage(
        'shangshu',
        { change_request_id: changeRequest.id },
        {
          workspace_id: pm.workspaceId,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        'change_confirmed'
      )
    );

    const updatedStages = await dbModule.db
      .select()
      .from(schemaModule.pipelineStageInstances)
      .where(eq(schemaModule.pipelineStageInstances.runId, run.id));
    const stageB = updatedStages.find((stage) => stage.stageKey === 'B');
    expect(stageB?.plannedEnd?.toISOString().slice(0, 10)).toBe('2026-04-01');
    const implementedRows = await dbModule.db
      .select()
      .from(schemaModule.changeRequests)
      .where(eq(schemaModule.changeRequests.id, changeRequest.id));
    expect(implementedRows[0]!.status).toBe('implemented');
    expect(imAdapter.sendDM).toHaveBeenCalled();
  });

  it('writes capacity snapshots and emits overload alert', async () => {
    if (!integrationReady) {
      return;
    }
    const { workspace, project } = await insertWorkspaceAndProject();
    const userRows = await dbModule.db
      .insert(schemaModule.users)
      .values({
        workspaceId: workspace.id,
        name: 'Designer',
        email: `${randomUUID()}@gw-pm.local`,
        role: 'designer',
        imUserId: 'designer-im',
        workHoursPerWeek: '40',
        skills: ['ui_designer']
      })
      .returning();
    const user = userRows[0]!;
    const pipelineRows = await dbModule.db
      .insert(schemaModule.pipelines)
      .values({
        workspaceId: workspace.id,
        name: 'Capacity Template',
        businessType: 'ui',
        complexityTier: 's',
        totalWeeksDefault: 4,
        milestoneAnchors: [],
        stages: [],
        historicalVelocities: {},
        isSystemTemplate: false
      })
      .returning();
    const runRows = await dbModule.db
      .insert(schemaModule.pipelineRuns)
      .values({
        pipelineId: pipelineRows[0]!.id,
        projectId: project.id,
        name: 'Capacity Run',
        complexityTier: 's',
        status: 'active'
      })
      .returning();
    const run = runRows[0]!;
    await dbModule.db.insert(schemaModule.pipelineStageInstances).values([
      {
        runId: run.id,
        stageKey: 'W1-A',
        roleType: 'ui_designer',
        assigneeId: user.id,
        plannedStart: new Date('2026-03-23T00:00:00.000Z'),
        plannedEnd: new Date('2026-03-27T00:00:00.000Z'),
        estimatedHours: 24,
        dependsOn: [],
        status: 'active'
      },
      {
        runId: run.id,
        stageKey: 'W1-B',
        roleType: 'ui_designer',
        assigneeId: user.id,
        plannedStart: new Date('2026-03-24T00:00:00.000Z'),
        plannedEnd: new Date('2026-03-28T00:00:00.000Z'),
        estimatedHours: 24,
        dependsOn: [],
        status: 'active'
      },
      {
        runId: run.id,
        stageKey: 'W2-A',
        roleType: 'ui_designer',
        assigneeId: user.id,
        plannedStart: new Date('2026-03-30T00:00:00.000Z'),
        plannedEnd: new Date('2026-04-03T00:00:00.000Z'),
        estimatedHours: 24,
        dependsOn: [],
        status: 'active'
      },
      {
        runId: run.id,
        stageKey: 'W2-B',
        roleType: 'ui_designer',
        assigneeId: user.id,
        plannedStart: new Date('2026-03-31T00:00:00.000Z'),
        plannedEnd: new Date('2026-04-04T00:00:00.000Z'),
        estimatedHours: 24,
        dependsOn: [],
        status: 'active'
      }
    ]);
    const enqueue = vi.fn().mockResolvedValue('job-overload');
    const capacity = new capacityModule.CapacityAgent({
      queue: { enqueue },
      now: () => new Date('2026-03-17T00:00:00.000Z'),
      registry: createRegistry(JSON.stringify({ ok: true })).registry
    });

    await capacity.handle(
      buildMessage(
        'capacity',
        { workspace_id: workspace.id },
        {
          workspace_id: workspace.id,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        }
      )
    );

    const snapshots = await dbModule.db
      .select()
      .from(schemaModule.capacitySnapshots)
      .where(eq(schemaModule.capacitySnapshots.workspaceId, workspace.id));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some((snapshot) => snapshot.overloadFlag)).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'libu_bing',
        payload: expect.objectContaining({
          weeks_overloaded: 2
        })
      })
    );
  });
});
