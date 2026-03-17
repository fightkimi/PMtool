import { and, eq, inArray } from 'drizzle-orm';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import {
  changeRequests,
  pipelineRuns,
  pipelines,
  postMortems,
  risks,
  tasks,
  type InsertPostMortem,
  type SelectPipeline,
  type SelectPipelineRun,
  type SelectPostMortem,
  type SelectRisk,
  type SelectTask
} from '@/lib/schema';

type PostMortemDeps = BaseAgentDeps & {
  getCompletedRuns?: (projectId: string) => Promise<SelectPipelineRun[]>;
  getDoneTasks?: (projectId: string) => Promise<SelectTask[]>;
  getProjectRisks?: (projectId: string) => Promise<SelectRisk[]>;
  getChangeRequestCount?: (projectId: string) => Promise<number>;
  upsertPostMortem?: (projectId: string, data: Partial<InsertPostMortem>) => Promise<void>;
  getPipelinesForProject?: (projectId: string) => Promise<SelectPipeline[]>;
  updatePipelineVelocity?: (pipelineId: string, roleType: string, multiplier: number) => Promise<void>;
};

const POSTMORTEM_PROMPT = `你是项目复盘专家，基于以下项目数据提炼复盘内容。

数据：{{PROJECT_STATS}}

请返回 JSON（严格格式）：
{
  "lessons": ["具体教训1（指明是什么环节的问题）", ...],
  "recommendations": ["对下一个同类项目的具体建议1", ...],
  "template_adjustments": {
    "role_type_1": { "multiplier": 数字（建议工时调整系数，1.0=不变）},
    ...
  }
}

lessons 和 recommendations 各 3-5 条，具体可操作。
template_adjustments 只针对偏差 > 20% 的工种。`;

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class PostMortemAgent extends BaseAgent {
  readonly agentType = 'postmortem' as const;

  private readonly getCompletedRunsFn: (projectId: string) => Promise<SelectPipelineRun[]>;

  private readonly getDoneTasksFn: (projectId: string) => Promise<SelectTask[]>;

  private readonly getProjectRisksFn: (projectId: string) => Promise<SelectRisk[]>;

  private readonly getChangeRequestCountFn: (projectId: string) => Promise<number>;

  private readonly upsertPostMortemFn: (projectId: string, data: Partial<InsertPostMortem>) => Promise<void>;

  private readonly getPipelinesForProjectFn: (projectId: string) => Promise<SelectPipeline[]>;

  private readonly updatePipelineVelocityFn: (pipelineId: string, roleType: string, multiplier: number) => Promise<void>;

  constructor(deps: PostMortemDeps = {}) {
    super(deps);
    this.getCompletedRunsFn = deps.getCompletedRuns ?? defaultGetCompletedRuns;
    this.getDoneTasksFn = deps.getDoneTasks ?? defaultGetDoneTasks;
    this.getProjectRisksFn = deps.getProjectRisks ?? defaultGetProjectRisks;
    this.getChangeRequestCountFn = deps.getChangeRequestCount ?? defaultGetChangeRequestCount;
    this.upsertPostMortemFn = deps.upsertPostMortem ?? defaultUpsertPostMortem;
    this.getPipelinesForProjectFn = deps.getPipelinesForProject ?? defaultGetPipelinesForProject;
    this.updatePipelineVelocityFn = deps.updatePipelineVelocity ?? defaultUpdatePipelineVelocity;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as { project_id: string };
    const project = await this.getProject(payload.project_id);
    const [runs, doneTasks, projectRisks, changeRequestCount] = await Promise.all([
      this.getCompletedRunsFn(project.id),
      this.getDoneTasksFn(project.id),
      this.getProjectRisksFn(project.id),
      this.getChangeRequestCountFn(project.id)
    ]);

    const scheduleAccuracy = average(
      runs
        .filter((run) => run.actualEnd && run.plannedEnd)
        .map((run) => run.actualEnd!.getTime() / run.plannedEnd!.getTime())
    );
    const estimateAccuracy = average(
      doneTasks
        .filter((task) => task.actualHours != null && task.estimatedHours != null && Number(task.estimatedHours) > 0)
        .map((task) => Number(task.actualHours) / Number(task.estimatedHours))
    );
    const agentRisks = projectRisks.filter((risk) => risk.detectedBy === 'agent');
    const resolvedAgentRisks = agentRisks.filter((risk) => risk.status === 'resolved');
    const riskHitRate = agentRisks.length === 0 ? 0 : resolvedAgentRisks.length / agentRisks.length;
    const velocityByRole = Object.fromEntries(
      Object.entries(
        doneTasks.reduce<Record<string, number[]>>((acc, task) => {
          const key = task.department ?? 'unknown';
          acc[key] = [...(acc[key] ?? []), Number(task.actualHours ?? '0')];
          return acc;
        }, {})
      ).map(([role, values]) => [role, average(values)])
    );

    const stats = {
      schedule_accuracy: scheduleAccuracy,
      estimate_accuracy: estimateAccuracy,
      risk_hit_rate: riskHitRate,
      velocity_by_role: velocityByRole,
      change_request_count: changeRequestCount
    };

    const aiResponse = await this.getAIAdapter().chat(
      [
        { role: 'system', content: POSTMORTEM_PROMPT },
        { role: 'user', content: JSON.stringify(stats) }
      ],
      {}
    );
    const parsed = JSON.parse(aiResponse.content) as {
      lessons: string[];
      recommendations: string[];
      template_adjustments: Record<string, { multiplier: number }>;
    };

    await this.upsertPostMortemFn(project.id, {
      projectId: project.id,
      scheduleAccuracy: scheduleAccuracy.toFixed(2),
      estimateAccuracy: estimateAccuracy.toFixed(2),
      riskHitRate: riskHitRate.toFixed(2),
      velocityByRole: velocityByRole as Record<string, number>,
      changeRequestCount,
      lessonsLearned: parsed.lessons,
      recommendations: parsed.recommendations
    });

    const relatedPipelines = await this.getPipelinesForProjectFn(project.id);
    for (const [roleType, config] of Object.entries(parsed.template_adjustments)) {
      for (const pipeline of relatedPipelines) {
        await this.updatePipelineVelocityFn(pipeline.id, roleType, config.multiplier);
      }
    }

    await this.sendPMCard(project.id, {
      title: '📊 项目复盘报告已生成',
      content: `排期准确率：${Math.round(scheduleAccuracy * 100)}% | 工时准确率：${Math.round(estimateAccuracy * 100)}% | 变更次数：${changeRequestCount}
关键教训：${parsed.lessons[0] ?? '无'}`,
      buttons: [{ text: '查看完整报告', action: `view_postmortem:${project.id}` }]
    });

    return this.createMessage(
      'postmortem',
      { project_id: project.id, generated: true },
      {
        workspace_id: project.workspaceId,
        project_id: project.id,
        job_id: `job-${Date.now()}`,
        trace_ids: []
      },
      2,
      'response'
    );
  }
}

const postMortemAgent = new PostMortemAgent();

export default postMortemAgent;

/* v8 ignore next */
async function defaultGetCompletedRuns(projectId: string): Promise<SelectPipelineRun[]> {
  return db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
}

/* v8 ignore next */
async function defaultGetDoneTasks(projectId: string): Promise<SelectTask[]> {
  return db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'done')));
}

/* v8 ignore next */
async function defaultGetProjectRisks(projectId: string): Promise<SelectRisk[]> {
  return db.select().from(risks).where(eq(risks.projectId, projectId));
}

/* v8 ignore next */
async function defaultGetChangeRequestCount(projectId: string): Promise<number> {
  const rows = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.projectId, projectId));
  return rows.length;
}

/* v8 ignore next */
async function defaultUpsertPostMortem(projectId: string, data: Partial<InsertPostMortem>): Promise<void> {
  const rows = await db.select().from(postMortems).where(eq(postMortems.projectId, projectId));
  if (rows.length > 0) {
    await db.update(postMortems).set(data).where(eq(postMortems.projectId, projectId));
    return;
  }
  await db.insert(postMortems).values(data as InsertPostMortem);
}

/* v8 ignore next */
async function defaultGetPipelinesForProject(projectId: string): Promise<SelectPipeline[]> {
  const runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  if (runs.length === 0) {
    return [];
  }
  return db.select().from(pipelines).where(inArray(pipelines.id, runs.map((run) => run.pipelineId)));
}

/* v8 ignore next */
async function defaultUpdatePipelineVelocity(pipelineId: string, roleType: string, multiplier: number): Promise<void> {
  const rows = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
  const current = rows[0];
  if (!current) {
    return;
  }
  await db.update(pipelines).set({
    historicalVelocities: {
      ...current.historicalVelocities,
      [roleType]: { multiplier, updated_at: new Date().toISOString() }
    }
  }).where(eq(pipelines.id, pipelineId));
}
