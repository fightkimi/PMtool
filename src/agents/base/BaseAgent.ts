import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { registry, type AdapterRegistry } from '@/adapters/registry';
import type { IMCard, IMMessage, IMAdapter, AIAdapter } from '@/adapters/types';
import { db } from '@/lib/db';
import { createAgentJob, updateAgentJob } from '@/lib/queries/agent_jobs';
import { getProjectById } from '@/lib/queries/projects';
import { users, type SelectProject } from '@/lib/schema';
import type { AgentMessage, AgentType } from './types';

type CachedProject = {
  project: SelectProject;
  expiresAt: number;
};

type BaseAgentDeps = {
  registry?: Pick<AdapterRegistry, 'getIM' | 'getAI'>;
  createAgentJob?: typeof createAgentJob;
  updateAgentJob?: typeof updateAgentJob;
  getProjectById?: typeof getProjectById;
  getPMIMUserId?: (pmId: string) => Promise<string | null>;
  now?: () => Date;
};

const PROJECT_CACHE_TTL_MS = 60 * 1000;

export abstract class BaseAgent {
  abstract readonly agentType: AgentType;

  private readonly adapters: Pick<AdapterRegistry, 'getIM' | 'getAI'>;

  private readonly createAgentJobFn: typeof createAgentJob;

  private readonly updateAgentJobFn: typeof updateAgentJob;

  private readonly getProjectByIdFn: typeof getProjectById;

  private readonly getPMIMUserIdFn: (pmId: string) => Promise<string | null>;

  private readonly now: () => Date;

  private readonly projectCache = new Map<string, CachedProject>();

  protected constructor(deps: BaseAgentDeps = {}) {
    this.adapters = deps.registry ?? registry;
    this.createAgentJobFn = deps.createAgentJob ?? createAgentJob;
    this.updateAgentJobFn = deps.updateAgentJob ?? updateAgentJob;
    this.getProjectByIdFn = deps.getProjectById ?? getProjectById;
    this.getPMIMUserIdFn = deps.getPMIMUserId ?? this.defaultGetPMIMUserId;
    this.now = deps.now ?? (() => new Date());
  }

  abstract handle(message: AgentMessage): Promise<AgentMessage>;

  async run(message: AgentMessage): Promise<AgentMessage> {
    const startedAt = this.now();
    const createdJob = await this.createAgentJobFn({
      workspaceId: message.context.workspace_id,
      agentType: this.agentType,
      trigger: message.context.trace_ids.length > 0 ? 'agent_chain' : 'manual',
      input: message as unknown as Record<string, unknown>,
      status: 'running',
      startedAt,
      createdAt: startedAt
    });

    const jobId = createdJob.id;
    const runMessage: AgentMessage = {
      ...message,
      context: {
        ...message.context,
        job_id: jobId,
        trace_ids: message.context.job_id
          ? [...message.context.trace_ids, message.context.job_id]
          : [...message.context.trace_ids]
      }
    };

    try {
      const result = await this.handle(runMessage);
      await this.updateAgentJobFn(jobId, {
        status: 'success',
        output: result as unknown as Record<string, unknown>,
        finishedAt: this.now()
      });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.updateAgentJobFn(jobId, {
        status: 'failed',
        errorMessage: err.message,
        finishedAt: this.now()
      });
      throw err;
    }
  }

  protected getIMAdapter(): IMAdapter {
    return this.adapters.getIM();
  }

  protected getAIAdapter(): AIAdapter {
    return this.adapters.getAI();
  }

  protected async notifyGroup(projectId: string, text: string): Promise<void> {
    const project = await this.getProject(projectId);
    const target = project.wecomBotWebhook ?? project.wecomGroupId ?? project.wecomMgmtGroupId;
    if (!target) {
      return;
    }

    await this.getIMAdapter().sendMarkdown(target, text);
  }

  protected async sendCard(projectId: string, card: IMCard): Promise<void> {
    const project = await this.getProject(projectId);
    const target = project.wecomBotWebhook ?? project.wecomGroupId ?? project.wecomMgmtGroupId;
    if (!target) {
      return;
    }

    await this.getIMAdapter().sendCard(target, card);
  }

  protected async notifyPM(projectId: string, text: string): Promise<void> {
    await this.sendPMMessage(projectId, { type: 'text', text });
  }

  protected async sendPMCard(projectId: string, card: IMCard): Promise<void> {
    await this.sendPMMessage(projectId, { type: 'card', card });
  }

  protected async getProject(projectId: string): Promise<SelectProject> {
    const cached = this.projectCache.get(projectId);
    const now = this.now().getTime();
    if (cached && cached.expiresAt > now) {
      return cached.project;
    }

    const project = await this.getProjectByIdFn(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.projectCache.set(projectId, {
      project,
      expiresAt: now + PROJECT_CACHE_TTL_MS
    });

    return project;
  }

  protected createMessage(
    to: AgentType,
    payload: Record<string, unknown>,
    context: AgentMessage['context'],
    priority: AgentMessage['priority'] = 2,
    type: AgentMessage['type'] = 'request'
  ): AgentMessage {
    return {
      id: randomUUID(),
      from: this.agentType,
      to,
      type,
      payload,
      context,
      priority,
      created_at: this.now().toISOString()
    };
  }

  private async sendPMMessage(projectId: string, content: IMMessage): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project.pmId) {
      return;
    }

    const imUserId = await this.getPMIMUserIdFn(project.pmId);
    if (!imUserId) {
      return;
    }

    await this.getIMAdapter().sendDM(imUserId, content);
  }

  private async defaultGetPMIMUserId(pmId: string): Promise<string | null> {
    const rows = await db.select().from(users).where(eq(users.id, pmId));
    return rows[0]?.imUserId ?? null;
  }
}

export type { BaseAgentDeps };
