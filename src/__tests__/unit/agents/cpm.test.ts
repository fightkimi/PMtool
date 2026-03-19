import { describe, expect, it, vi } from 'vitest';
import { CPMEngine } from '@/agents/libu_gong/CPMEngine';
import type {
  InsertPipelineStageInstance,
  SelectPipeline,
  SelectPipelineRun,
  SelectPipelineStageInstance,
  SelectProject
} from '@/lib/schema';

function makeStage(
  id: string,
  stageKey: string,
  dependsOn: string[],
  estimatedHours: number,
  overrides: Partial<SelectPipelineStageInstance> = {}
): SelectPipelineStageInstance {
  return {
    id,
    runId: 'run-1',
    stageKey,
    roleType: 'dev',
    assigneeId: null,
    plannedStart: new Date('2026-04-01T00:00:00Z'),
    plannedEnd: new Date('2026-04-01T00:00:00Z'),
    actualStart: null,
    actualEnd: null,
    estimatedHours,
    dependsOn,
    floatDays: 0,
    status: 'pending',
    tableRecordId: null,
    taskId: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides
  };
}

const runFixture: SelectPipelineRun = {
  id: 'run-1',
  pipelineId: 'pipeline-1',
  projectId: 'project-1',
  name: 'Run 1',
  complexityTier: 's',
  status: 'planning',
  plannedEnd: null,
  actualEnd: null,
  versionTarget: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z')
};

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: null,
  wecomGroupId: 'group-1',
  wecomBotWebhook: 'https://example.com/hook',
  wecomMgmtGroupId: null,
  smartTableRootId: null,
  taskTableWebhook: null,
  pipelineTableWebhook: null,
  capacityTableWebhook: null,
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

function createEngine(options: {
  stages: SelectPipelineStageInstance[];
  pipeline?: SelectPipeline;
  run?: SelectPipelineRun;
}): {
  engine: CPMEngine;
  batchUpdateStagesMock: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  sendCard: ReturnType<typeof vi.fn>;
  logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
  const stageMap = new Map(options.stages.map((stage) => [stage.id, stage]));
  const batchUpdateStagesMock = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue('bull-job-1');
  const sendCard = vi.fn().mockResolvedValue(undefined);
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
  const pipeline =
    options.pipeline ??
    ({
      id: 'pipeline-1',
      workspaceId: 'workspace-1',
      name: 'Pipeline',
      businessType: 'ui',
      complexityTier: 's',
      milestoneAnchors: [],
      totalWeeksDefault: 4,
      stages: [],
      historicalVelocities: {},
      isSystemTemplate: true,
      createdAt: new Date(),
      updatedAt: new Date()
    } satisfies SelectPipeline);
  const run = options.run ?? runFixture;

  const engine = new CPMEngine({
    getStagesByRun: vi.fn().mockResolvedValue(options.stages),
    batchUpdateStages: batchUpdateStagesMock,
    getStageById: vi.fn().mockImplementation(async (id: string) => stageMap.get(id) ?? null),
    getRunById: vi.fn().mockResolvedValue(run),
    getPipelineById: vi.fn().mockResolvedValue(pipeline),
    getProjectById: vi.fn().mockResolvedValue(projectFixture),
    getStagesByProjectId: vi.fn().mockResolvedValue(options.stages),
    queue: { enqueue },
    imAdapter: {
      sendMessage: vi.fn(),
      sendMarkdown: vi.fn(),
      sendCard,
      sendDM: vi.fn(),
      parseIncoming: vi.fn(),
      getGroupMembers: vi.fn()
    },
    logger
  });

  return { engine, batchUpdateStagesMock, enqueue, sendCard, logger };
}

describe('CPMEngine', () => {
  it('computes critical path for linear chain', async () => {
    const { engine } = createEngine({
      stages: [
        makeStage('a', 'A', [], 40),
        makeStage('b', 'B', ['A'], 40),
        makeStage('c', 'C', ['B'], 40)
      ]
    });

    const result = await engine.computeCriticalPath('run-1');

    expect(result.critical_path).toEqual(['A', 'B', 'C']);
    expect(result.float_map).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('computes float for parallel branch', async () => {
    const { engine } = createEngine({
      stages: [
        makeStage('a', 'A', [], 40),
        makeStage('b', 'B', ['A'], 40),
        makeStage('c', 'C', ['A'], 24),
        makeStage('d', 'D', ['B', 'C'], 16)
      ]
    });

    const result = await engine.computeCriticalPath('run-1');

    expect(result.critical_path).toEqual(['A', 'B', 'D']);
    expect(result.float_map.C).toBe(2);
  });

  it('clamps negative float to zero and warns', async () => {
    const { engine, logger } = createEngine({
      run: {
        ...runFixture,
        plannedEnd: new Date('2026-04-06T00:00:00Z')
      },
      stages: [
        makeStage('a', 'A', [], 40),
        makeStage('b', 'B', ['A'], 40)
      ]
    });

    const result = await engine.computeCriticalPath('run-1');

    expect(Object.values(result.float_map).every((value) => value >= 0)).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('propagates cascade update through successors', async () => {
    const stages = [
      makeStage('a', 'A', [], 40, {
        plannedStart: new Date('2026-04-01T00:00:00Z'),
        plannedEnd: new Date('2026-04-06T00:00:00Z')
      }),
      makeStage('b', 'B', ['A'], 24, {
        plannedStart: new Date('2026-04-06T00:00:00Z'),
        plannedEnd: new Date('2026-04-09T00:00:00Z')
      }),
      makeStage('c', 'C', ['B'], 16, {
        plannedStart: new Date('2026-04-09T00:00:00Z'),
        plannedEnd: new Date('2026-04-11T00:00:00Z')
      })
    ];
    const { engine, batchUpdateStagesMock } = createEngine({ stages });

    const result = await engine.cascadeUpdate('a', new Date('2026-04-08T00:00:00Z'));

    expect(result.affected_stage_ids).toEqual(['b', 'c']);
    const updates = batchUpdateStagesMock.mock.calls[0]?.[0] as Array<{
      id: string;
      data: Partial<InsertPipelineStageInstance>;
    }>;
    expect(updates.find((item) => item.id === 'b')?.data.plannedStart).toEqual(new Date('2026-04-08T00:00:00.000Z'));
    expect(updates.find((item) => item.id === 'c')?.data.plannedStart).toEqual(new Date('2026-04-11T00:00:00.000Z'));
  });

  it('escalates when cascade impacts milestone', async () => {
    const stages = [
      makeStage('a', 'A', [], 40, {
        plannedStart: new Date('2026-04-01T00:00:00Z'),
        plannedEnd: new Date('2026-04-06T00:00:00Z'),
        floatDays: 0
      }),
      makeStage('b', 'B', ['A'], 40, {
        plannedStart: new Date('2026-04-20T00:00:00Z'),
        plannedEnd: new Date('2026-04-25T00:00:00Z'),
        floatDays: 0
      })
    ];
    const { engine, enqueue, sendCard } = createEngine({
      stages,
      pipeline: {
        id: 'pipeline-1',
        workspaceId: 'workspace-1',
        name: 'Pipeline',
        businessType: 'ui',
        complexityTier: 's',
        milestoneAnchors: [{ name: '功能封版', offset_weeks: 4 }],
        totalWeeksDefault: 4,
        stages: [],
        historicalVelocities: {},
        isSystemTemplate: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    const result = await engine.cascadeUpdate('a', new Date('2026-04-27T00:00:00Z'));

    expect(result.milestone_impact).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'zhongshui', type: 'escalate' }));
    expect(sendCard).toHaveBeenCalled();
  });

  it('detects overlap conflicts', () => {
    const { engine } = createEngine({
      stages: []
    });

    const conflicts = engine.detectConflicts([
      makeStage('a', 'A', [], 40, {
        assigneeId: 'u1',
        plannedStart: new Date('2026-04-01T00:00:00Z'),
        plannedEnd: new Date('2026-04-10T00:00:00Z')
      }),
      makeStage('b', 'B', [], 40, {
        assigneeId: 'u1',
        plannedStart: new Date('2026-04-08T00:00:00Z'),
        plannedEnd: new Date('2026-04-15T00:00:00Z')
      })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlap_days).toBe(2);
  });

  it('returns no conflicts when schedule does not overlap', () => {
    const { engine } = createEngine({
      stages: []
    });

    const conflicts = engine.detectConflicts([
      makeStage('a', 'A', [], 40, {
        assigneeId: 'u1',
        plannedStart: new Date('2026-04-01T00:00:00Z'),
        plannedEnd: new Date('2026-04-10T00:00:00Z')
      }),
      makeStage('b', 'B', [], 40, {
        assigneeId: 'u1',
        plannedStart: new Date('2026-04-11T00:00:00Z'),
        plannedEnd: new Date('2026-04-15T00:00:00Z')
      })
    ]);

    expect(conflicts).toEqual([]);
  });
});
