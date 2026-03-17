import { randomUUID } from 'node:crypto';
import { getActiveProjects } from '@/lib/queries/projects';
import type { IntentType } from '@/adapters/wecom/IntentParser';
import { agentQueue, type AgentQueue } from '@/agents/base/AgentQueue';
import { BaseAgent, type BaseAgentDeps } from '@/agents/base/BaseAgent';
import type { AgentMessage, AgentType } from '@/agents/base/types';

type QueueLike = Pick<AgentQueue, 'enqueue'>;

type ZhongshuiDeps = BaseAgentDeps & {
  queue?: QueueLike;
  getActiveProjects?: typeof getActiveProjects;
};

const INTENT_SYSTEM_PROMPT =
  '判断以下消息的项目管理意图，返回：parse_requirement/weekly_report/risk_scan/capacity_evaluate/capacity_forecast/change_request/postmortem/unknown';

function normalizeIntent(value: string): IntentType {
  const normalized = value.trim() as IntentType;
  const allowed: IntentType[] = [
    'parse_requirement',
    'weekly_report',
    'risk_scan',
    'capacity_evaluate',
    'capacity_forecast',
    'change_request',
    'postmortem',
    'unknown'
  ];

  return allowed.includes(normalized) ? normalized : 'unknown';
}

function shouldEscalate(text: string): boolean {
  return (
    text.includes('里程碑') ||
    text.includes('版本节点') ||
    (text.includes('预算') &&
      (text.includes('超预算') || text.includes('超过预算') || text.includes('追加预算') || text.includes('超出预算')))
  );
}

export class ZhongshuiAgent extends BaseAgent {
  readonly agentType = 'zhongshui' as const;

  private readonly queue: QueueLike;

  private readonly getActiveProjectsFn: typeof getActiveProjects;

  constructor(deps: ZhongshuiDeps = {}) {
    super(deps);
    this.queue = deps.queue ?? agentQueue;
    this.getActiveProjectsFn = deps.getActiveProjects ?? getActiveProjects;
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    const payload = message.payload as {
      intent?: IntentType;
      params?: Record<string, string>;
      project_id?: string;
    };
    const params = payload.params ?? {};
    const projectId = payload.project_id ?? message.context.project_id;
    if (!projectId) {
      throw new Error('project_id is required');
    }

    const rawText = params.text ?? params.content ?? '';
    if (shouldEscalate(rawText)) {
      const escalation = this.createMessage(
        'zhongshui',
        { project_id: projectId, reason: rawText, action: 'pm_review_required' },
        {
          ...message.context,
          project_id: projectId
        },
        1,
        'escalate'
      );
      await this.sendPMCard(projectId, {
        title: '需要 PM 确认',
        content: rawText || '检测到需要人工确认的高风险操作。'
      });
      return escalation;
    }

    const intent = payload.intent === 'unknown' ? await this.resolveIntent(rawText) : payload.intent ?? 'unknown';
    const outbound = this.buildOutboundMessage(intent, params, projectId, message);
    await this.queue.enqueue(outbound);
    return outbound;
  }

  async triggerDailyScan(workspaceId: string): Promise<void> {
    const projects = await this.getActiveProjectsFn(workspaceId);

    await Promise.all(
      projects.map((project) =>
        this.queue.enqueue(
          this.createMessage(
            'libu_bing',
            { project_id: project.id, type: 'daily_scan' },
            {
              workspace_id: workspaceId,
              project_id: project.id,
              job_id: randomUUID(),
              trace_ids: []
            }
          )
        )
      )
    );
  }

  private async resolveIntent(text: string): Promise<IntentType> {
    const response = await this.getAIAdapter().chat(
      [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      {}
    );

    return normalizeIntent(response.content);
  }

  private buildOutboundMessage(
    intent: IntentType,
    params: Record<string, string>,
    projectId: string,
    message: AgentMessage
  ): AgentMessage {
    const baseContext = {
      workspace_id: message.context.workspace_id,
      project_id: projectId,
      job_id: message.context.job_id,
      trace_ids: [...message.context.trace_ids]
    };

    const routeMap: Record<Exclude<IntentType, 'unknown'>, { to: AgentType; payload: Record<string, unknown> }> = {
      parse_requirement: {
        to: 'zhongshu',
        payload: { content: params.content ?? params.text ?? '', project_id: projectId }
      },
      weekly_report: {
        to: 'libu_li2',
        payload: { project_id: projectId, type: 'weekly' }
      },
      risk_scan: {
        to: 'libu_bing',
        payload: { project_id: projectId }
      },
      capacity_evaluate: {
        to: 'capacity',
        payload: { project_id: projectId, spec: params }
      },
      capacity_forecast: {
        to: 'libu_li',
        payload: { project_id: projectId, weeks: 8 }
      },
      change_request: {
        to: 'menxia',
        payload: { project_id: projectId, type: 'change_request', description: params.text ?? params.content ?? '' }
      },
      postmortem: {
        to: 'postmortem',
        payload: { project_id: projectId }
      }
    };

    const route = routeMap[intent === 'unknown' ? 'risk_scan' : intent];

    return this.createMessage(route.to, route.payload, baseContext);
  }
}

const zhongshuiAgent = new ZhongshuiAgent();

export default zhongshuiAgent;
