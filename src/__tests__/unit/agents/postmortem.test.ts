import { describe, expect, it, vi } from 'vitest';
import { PostMortemAgent } from '@/agents/postmortem/PostMortemAgent';
import type { AIAdapter, IMAdapter } from '@/adapters/types';
import type { SelectPipeline, SelectPipelineRun, SelectProject, SelectRisk, SelectTask } from '@/lib/schema';

const projectFixture: SelectProject = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: 'pm-1',
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

describe('PostMortemAgent', () => {
  it('generates postmortem, updates template velocities, and notifies PM', async () => {
    const im: IMAdapter = {
      sendMessage: vi.fn(),
      sendMarkdown: vi.fn(),
      sendCard: vi.fn(),
      sendDM: vi.fn(),
      parseIncoming: vi.fn(),
      getGroupMembers: vi.fn()
    };
    const ai: AIAdapter = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          lessons: ['教训1'],
          recommendations: ['建议1'],
          template_adjustments: { ui_designer: { multiplier: 1.2 } }
        }),
        inputTokens: 10,
        outputTokens: 10
      }),
      stream: vi.fn()
    };
    const upsertPostMortem = vi.fn().mockResolvedValue(undefined);
    const updatePipelineVelocity = vi.fn().mockResolvedValue(undefined);
    const agent = new PostMortemAgent({
      registry: {
        getIM: () => im,
        getAI: () => ai
      },
      getProjectById: vi.fn().mockResolvedValue(projectFixture),
      createAgentJob: vi.fn(),
      updateAgentJob: vi.fn(),
      getPMIMUserId: vi.fn().mockResolvedValue('pm-im-1'),
      getCompletedRuns: vi.fn().mockResolvedValue([
        {
          id: 'run-1',
          pipelineId: 'pipeline-1',
          projectId: 'project-1',
          name: 'run',
          complexityTier: 's',
          status: 'completed',
          plannedEnd: new Date('2026-03-10T00:00:00Z'),
          actualEnd: new Date('2026-03-12T00:00:00Z'),
          versionTarget: null,
          createdAt: new Date('2026-03-01T00:00:00Z'),
          updatedAt: new Date()
        }
      ] satisfies SelectPipelineRun[]),
      getDoneTasks: vi.fn().mockResolvedValue([
        { id: 't1', projectId: 'project-1', parentId: null, title: 'A', description: null, status: 'done', priority: 'medium', assigneeId: null, reviewerId: null, department: 'ui_designer' as any, estimatedHours: 10, actualHours: 12, earliestStart: null, latestFinish: null, floatDays: null, githubIssueNumber: null, acceptanceCriteria: [], tableRecordId: null, dueAt: null, completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
        { id: 't2', projectId: 'project-1', parentId: null, title: 'B', description: null, status: 'done', priority: 'medium', assigneeId: null, reviewerId: null, department: 'ui_designer' as any, estimatedHours: 10, actualHours: 12, earliestStart: null, latestFinish: null, floatDays: null, githubIssueNumber: null, acceptanceCriteria: [], tableRecordId: null, dueAt: null, completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
        { id: 't3', projectId: 'project-1', parentId: null, title: 'C', description: null, status: 'done', priority: 'medium', assigneeId: null, reviewerId: null, department: 'ui_designer' as any, estimatedHours: 10, actualHours: 12, earliestStart: null, latestFinish: null, floatDays: null, githubIssueNumber: null, acceptanceCriteria: [], tableRecordId: null, dueAt: null, completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
      ] satisfies SelectTask[]),
      getProjectRisks: vi.fn().mockResolvedValue([
        { id: 'r1', projectId: 'project-1', taskId: null, runId: null, level: 'medium', description: 'risk', status: 'resolved', mitigation: null, detectedBy: 'agent', tableRecordId: null, lastSeenAt: new Date(), createdAt: new Date(), resolvedAt: new Date() }
      ] satisfies SelectRisk[]),
      getChangeRequestCount: vi.fn().mockResolvedValue(2),
      upsertPostMortem,
      getPipelinesForProject: vi.fn().mockResolvedValue([
        { id: 'pipeline-1', workspaceId: 'workspace-1', name: '模板', businessType: 'ui', complexityTier: 's', milestoneAnchors: [], totalWeeksDefault: 4, stages: [], historicalVelocities: {}, isSystemTemplate: true, createdAt: new Date(), updatedAt: new Date() }
      ] satisfies SelectPipeline[]),
      updatePipelineVelocity
    });

    await agent.handle({
      id: 'msg-1',
      from: 'zhongshui',
      to: 'postmortem',
      type: 'request',
      payload: { project_id: 'project-1' },
      context: { workspace_id: 'workspace-1', project_id: 'project-1', job_id: 'job-1', trace_ids: [] },
      priority: 2,
      created_at: new Date().toISOString()
    });

    expect(upsertPostMortem).toHaveBeenCalled();
    expect(updatePipelineVelocity).toHaveBeenCalledWith('pipeline-1', 'ui_designer', 1.2);
    expect(im.sendDM).toHaveBeenCalled();
  });
});
