import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSetupProjectsHandlers } from '@/app/api/setup/projects/route';
import { buildProjectPmSummary, mapProjectToSetupSummary, validateProjectWebhookSchemas } from '@/app/api/setup/_dashboard';
import { createSetupStatusHandlers } from '@/app/api/setup/_status';
import type { SelectProject, SelectWorkspace } from '@/lib/schema';

const workspaceFixture: SelectWorkspace = {
  id: 'workspace-1',
  name: '光禾科技',
  slug: 'guanghe',
  plan: 'pro',
  adapterConfig: {},
  createdAt: new Date(),
  updatedAt: new Date()
};

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: '登录优化',
  type: 'office_app',
  status: 'active',
  pmId: null,
  wecomGroupId: 'wrwgiCUwAAVH9v77U0ANMMDZsbAIyStQ',
  wecomBotWebhook: null,
  wecomMgmtGroupId: null,
  smartTableRootId: 'root-1',
  taskTableWebhook: 'task-1',
  pipelineTableWebhook: null,
  capacityTableWebhook: 'capacity-1',
  riskTableWebhook: null,
  changeTableWebhook: null,
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
  githubRepo: null,
  budget: { total: 0, spent: 0, token_budget: 0 },
  startedAt: null,
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const originalEnv = {
  WECOM_BOT_ID: process.env.WECOM_BOT_ID,
  WECOM_BOT_SECRET: process.env.WECOM_BOT_SECRET,
  DEFAULT_AI_MODEL: process.env.DEFAULT_AI_MODEL,
  ARK_API_KEY: process.env.ARK_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  ZHIPU_API_KEY: process.env.ZHIPU_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
};

describe('setup', () => {
  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  it('GET /api/setup/status returns workspace and projects structure', async () => {
    process.env.WECOM_BOT_ID = 'aibhkPKd';
    process.env.WECOM_BOT_SECRET = 'secret';
    process.env.DEFAULT_AI_MODEL = 'doubao-fast';
    process.env.ARK_API_KEY = 'ark-key';

    const handlers = createSetupStatusHandlers({
      loadStatus: vi.fn().mockResolvedValue({
        workspace: { id: workspaceFixture.id, name: workspaceFixture.name },
        bot: { configured: true, botIdPreview: 'aibhkPKd***', connected: true },
        ai: {
          defaultModel: 'doubao-fast',
          providers: {
            doubao: true,
            minimax: false,
            zhipu: false,
            deepseek: false,
            claude: false
          }
        },
        tencentdoc: { configured: true, appIdPreview: 'Webhook 模式' },
        projects: [
          {
            id: projectFixture.id,
            name: projectFixture.name,
            type: projectFixture.type,
            status: projectFixture.status,
            groupId: projectFixture.wecomGroupId,
            mgmtGroupId: projectFixture.wecomMgmtGroupId,
            tableRootId: projectFixture.smartTableRootId,
            taskTableWebhook: projectFixture.taskTableWebhook,
            pipelineTableWebhook: projectFixture.pipelineTableWebhook,
            capacityTableWebhook: projectFixture.capacityTableWebhook,
            riskTableWebhook: projectFixture.riskTableWebhook,
            changeTableWebhook: projectFixture.changeTableWebhook,
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
            tables: {
              task: true,
              pipeline: false,
              capacity: true,
              risk: false
            },
            tableHealth: [],
            recentSyncs: [],
            healthSummary: { readyTables: 0, syncedTables: 0, attentionTables: 0 }
          }
        ]
      })
    });

    const response = await handlers.GET();
    const data = (await response.json()) as {
      workspace: { id: string; name: string };
      bot: { configured: boolean };
      ai: { providers: { doubao: boolean } };
      projects: Array<{ tables: { task: boolean; pipeline: boolean; capacity: boolean; risk: boolean } }>;
    };

    expect(data.workspace).toEqual({ id: 'workspace-1', name: '光禾科技' });
    expect(data.bot.configured).toBe(true);
    expect(data.ai.providers.doubao).toBe(true);
    expect(data.projects[0]?.tables).toEqual({
      task: true,
      pipeline: false,
      capacity: true,
      risk: false
    });
  });

  it('POST /api/setup/projects inserts a new project', async () => {
    const ensureWorkspace = vi.fn().mockResolvedValue(workspaceFixture);
    const createProject = vi.fn().mockResolvedValue({
      ...projectFixture,
      id: 'project-2',
      name: '新项目',
      type: 'custom',
      wecomGroupId: 'group-2',
      smartTableRootId: 'root-2',
      taskTableWebhook: null,
      capacityTableWebhook: null
    });
    const handlers = createSetupProjectsHandlers({
      ensureWorkspace,
      createProject
    });

    const response = await handlers.POST(
      new Request('http://localhost/api/setup/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: '新项目',
          type: 'custom',
          groupId: 'group-2',
          tableRootId: 'root-2'
        })
      })
    );
    const data = (await response.json()) as { id: string; name: string; groupId: string | null };

    expect(response.status).toBe(201);
    expect(createProject).toHaveBeenCalledWith('workspace-1', {
      name: '新项目',
      type: 'custom',
      groupId: 'group-2',
      tableRootId: 'root-2'
    });
    expect(data).toEqual(
      expect.objectContaining({
        id: 'project-2',
        name: '新项目',
        groupId: 'group-2'
      })
    );
  });

  it('status data reflects bot config and project table bindings', async () => {
    process.env.WECOM_BOT_ID = 'bot-id-12345678';
    process.env.WECOM_BOT_SECRET = 'bot-secret';
    process.env.ARK_API_KEY = 'ark-key';
    process.env.DEFAULT_AI_MODEL = 'doubao-fast';

    const handlers = createSetupStatusHandlers({
      loadStatus: vi.fn().mockResolvedValue({
        workspace: { id: workspaceFixture.id, name: workspaceFixture.name },
        bot: { configured: true, botIdPreview: 'bot-id-1***', connected: true },
        ai: {
          defaultModel: 'doubao-fast',
          providers: {
            doubao: true,
            minimax: false,
            zhipu: false,
            deepseek: false,
            claude: false
          }
        },
        tencentdoc: { configured: true, appIdPreview: 'Webhook 模式' },
        projects: [
          {
            id: projectFixture.id,
            name: projectFixture.name,
            type: projectFixture.type,
            status: projectFixture.status,
            groupId: projectFixture.wecomGroupId,
            mgmtGroupId: projectFixture.wecomMgmtGroupId,
            tableRootId: projectFixture.smartTableRootId,
            taskTableWebhook: projectFixture.taskTableWebhook,
            pipelineTableWebhook: projectFixture.pipelineTableWebhook,
            capacityTableWebhook: projectFixture.capacityTableWebhook,
            riskTableWebhook: projectFixture.riskTableWebhook,
            changeTableWebhook: projectFixture.changeTableWebhook,
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
            tables: {
              task: Boolean(projectFixture.taskTableWebhook),
              pipeline: Boolean(projectFixture.pipelineTableWebhook),
              capacity: Boolean(projectFixture.capacityTableWebhook),
              risk: Boolean(projectFixture.riskTableWebhook)
            },
            tableHealth: [],
            recentSyncs: [],
            healthSummary: { readyTables: 0, syncedTables: 0, attentionTables: 0 }
          }
        ]
      })
    });

    const response = await handlers.GET();
    const data = (await response.json()) as {
      bot: { configured: boolean };
      ai: { providers: { doubao: boolean } };
      projects: Array<{ tables: { task: boolean; pipeline: boolean; capacity: boolean; risk: boolean } }>;
    };

    expect(data.bot.configured).toBe(true);
    expect(data.ai.providers.doubao).toBe(true);
    expect(data.projects[0]?.tables.task).toBe(true);
    expect(data.projects[0]?.tables.pipeline).toBe(false);
    expect(data.projects[0]?.tables.capacity).toBe(true);
    expect(data.projects[0]?.tables.risk).toBe(false);
  });

  it('requires schema when webhook is configured for a project table', () => {
    expect(
      validateProjectWebhookSchemas({
        taskTableWebhook: 'https://example.com/webhook',
        taskTableSchema: {}
      })
    ).toContain('任务表已配置 Webhook');

    expect(
      validateProjectWebhookSchemas({
        taskTableWebhook: 'https://example.com/webhook',
        taskTableSchema: { f1: '任务名' }
      })
    ).toBeNull();
  });

  it('maps project table health into readable summary states', () => {
    const summary = mapProjectToSetupSummary(projectFixture, {
      task: { lastSyncedAt: new Date('2026-03-20T06:00:00.000Z'), recordCount: 3 },
      pipeline: { lastSyncedAt: null, recordCount: 0 },
      capacity: { lastSyncedAt: null, recordCount: 0 },
      risk: { lastSyncedAt: null, recordCount: 0 },
      change: { lastSyncedAt: null, recordCount: 0 }
    });

    expect(summary.tableHealth.find((item) => item.key === 'task')).toEqual(
      expect.objectContaining({
        state: 'synced',
        recordCount: 3,
        lastSyncedAt: '2026-03-20T06:00:00.000Z'
      })
    );
    expect(summary.tableHealth.find((item) => item.key === 'capacity')).toEqual(
      expect.objectContaining({
        state: 'needs_schema'
      })
    );
    expect(summary.healthSummary).toEqual({
      readyTables: 1,
      syncedTables: 1,
      attentionTables: 1
    });
    expect(summary.recentSyncs).toEqual([]);
    expect(summary.pmSummary).toEqual(
      expect.objectContaining({
        attentionLevel: 'medium',
        weeklyReportStatus: 'missing'
      })
    );
  });

  it('builds PM summary attention and highlights from project signals', () => {
    const summary = buildProjectPmSummary(
      {
        blockedTaskCount: 1,
        blockedStageCount: 1,
        overdueTaskCount: 2,
        dueSoonTaskCount: 1,
        openRiskCount: 3,
        criticalRiskCount: 1,
        milestoneRiskCount: 1,
        activeChangeCount: 2,
        lastWeeklyReportAt: new Date('2026-03-10T08:00:00.000Z')
      },
      new Date('2026-03-20T08:00:00.000Z')
    );

    expect(summary).toEqual(
      expect.objectContaining({
        blockedCount: 2,
        overdueCount: 2,
        openRiskCount: 3,
        criticalRiskCount: 1,
        milestoneRiskCount: 1,
        activeChangeCount: 2,
        weeklyReportStatus: 'stale',
        attentionLevel: 'high'
      })
    );
    expect(summary.highlights).toEqual([
      '阻塞 2 项，建议先确认责任人与恢复时间',
      '逾期 2 项，需要重新校准交付承诺',
      '里程碑风险 1 项，建议提前同步偏差'
    ]);
  });
});
