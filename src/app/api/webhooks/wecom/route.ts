import { randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { registry } from '@/adapters/registry';
import { parse as parseIntent, type IntentType } from '@/adapters/wecom/IntentParser';
import type { IMCard, IncomingMessage } from '@/adapters/types';
import { agentQueue } from '@/agents/base/AgentQueue';
import type { AgentMessage } from '@/agents/base/types';
import { db } from '@/lib/db';
import { changeRequests, postMortems, projects, type SelectPostMortem, type SelectProject } from '@/lib/schema';

type WeComWebhookDeps = {
  parseIncoming?: (payload: unknown) => Promise<IncomingMessage | null>;
  parseIntent?: (text: string) => { intent: IntentType; params: Record<string, string> };
  enqueue?: (message: AgentMessage) => Promise<string>;
  getProjectByGroupId?: (groupId: string) => Promise<SelectProject | null>;
  rejectChangeRequest?: (id: string) => Promise<void>;
  getPostMortemByProjectId?: (projectId: string) => Promise<SelectPostMortem | null>;
  sendGroupMarkdown?: (project: SelectProject, markdown: string) => Promise<void>;
  sendUserCard?: (userId: string, card: IMCard) => Promise<void>;
  now?: () => Date;
  botName?: string;
  token?: string;
};

function verifySignature(token: string, timestamp: string, nonce: string, signature: string): boolean {
  const raw = [token, timestamp, nonce].sort().join('');
  const digest = createHash('sha1').update(raw).digest('hex');
  return digest === signature;
}

function extractEncrypt(xml: string): string | null {
  const match = xml.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
  return match?.[1] ?? null;
}

function createMessage(to: AgentMessage['to'], type: AgentMessage['type'], payload: Record<string, unknown>, project: SelectProject, priority: AgentMessage['priority'], now: Date): AgentMessage {
  return {
    id: randomUUID(),
    from: 'zhongshui',
    to,
    type,
    payload,
    context: {
      workspace_id: project.workspaceId,
      project_id: project.id,
      job_id: randomUUID(),
      trace_ids: []
    },
    priority,
    created_at: now.toISOString()
  };
}

function getIntentPriority(intent: IntentType): AgentMessage['priority'] {
  return intent === 'change_request' || intent === 'risk_scan' ? 1 : 2;
}

async function defaultGetProjectByGroupId(groupId: string) {
  const rows = await db.select().from(projects).where(eq(projects.wecomGroupId, groupId));
  return rows[0] ?? null;
}

async function defaultRejectChangeRequest(id: string) {
  await db.update(changeRequests).set({ status: 'rejected', updatedAt: new Date() }).where(eq(changeRequests.id, id));
}

async function defaultGetPostMortemByProjectId(projectId: string) {
  const rows = await db.select().from(postMortems).where(eq(postMortems.projectId, projectId));
  return rows[0] ?? null;
}

async function defaultSendGroupMarkdown(project: SelectProject, markdown: string) {
  const target = project.wecomBotWebhook ?? project.wecomGroupId ?? project.wecomMgmtGroupId;
  if (!target) {
    return;
  }
  await registry.getIM().sendMarkdown(target, markdown);
}

async function defaultSendUserCard(userId: string, card: IMCard) {
  await registry.getIM().sendDM(userId, { type: 'card', card });
}

export function createWeComWebhookHandlers(deps: WeComWebhookDeps = {}) {
  const parseIncoming = deps.parseIncoming ?? ((payload: unknown) => registry.getIM().parseIncoming(payload));
  const parseIntentFn = deps.parseIntent ?? parseIntent;
  const enqueue = deps.enqueue ?? ((message: AgentMessage) => agentQueue.enqueue(message));
  const getProjectByGroupId = deps.getProjectByGroupId ?? defaultGetProjectByGroupId;
  const rejectChangeRequest = deps.rejectChangeRequest ?? defaultRejectChangeRequest;
  const getPostMortemByProjectId = deps.getPostMortemByProjectId ?? defaultGetPostMortemByProjectId;
  const sendGroupMarkdown = deps.sendGroupMarkdown ?? defaultSendGroupMarkdown;
  const sendUserCard = deps.sendUserCard ?? defaultSendUserCard;
  const now = deps.now ?? (() => new Date());
  const botName = deps.botName ?? process.env.WECOM_BOT_NAME ?? '助手';
  const token = deps.token ?? process.env.WECOM_BOT_TOKEN ?? '';

  return {
    async GET(request: Request) {
      const searchParams = new URL(request.url).searchParams;
      const signature = searchParams.get('signature') ?? '';
      const timestamp = searchParams.get('timestamp') ?? '';
      const nonce = searchParams.get('nonce') ?? '';
      const echostr = searchParams.get('echostr') ?? '';

      if (!token || !verifySignature(token, timestamp, nonce, signature)) {
        return new Response('invalid signature', { status: 401 });
      }

      return new Response(echostr, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    },

    async POST(request: Request) {
      const url = new URL(request.url);
      const rawBody = await request.text();
      const encrypted = extractEncrypt(rawBody);
      const payload =
        encrypted && url.searchParams.get('msg_signature')
          ? {
              Encrypt: encrypted,
              msg_signature: url.searchParams.get('msg_signature') ?? undefined,
              timestamp: url.searchParams.get('timestamp') ?? undefined,
              nonce: url.searchParams.get('nonce') ?? undefined
            }
          : rawBody;

      const msg = await parseIncoming(payload);
      if (!msg) {
        return Response.json({}, { status: 200 });
      }

      const project = await getProjectByGroupId(msg.groupId);
      if (!project) {
        return Response.json({}, { status: 200 });
      }

      if (msg.type === 'button_click' && msg.buttonAction) {
        const [actionType, id] = msg.buttonAction.split(':');
        if (actionType === 'change_confirmed' && id) {
          await enqueue(
            createMessage(
              'shangshu',
              'change_confirmed',
              { change_request_id: id },
              project,
              1,
              now()
            )
          );
        } else if (actionType === 'change_cancelled' && id) {
          await rejectChangeRequest(id);
          await sendGroupMarkdown(project, '⚪ 变更已取消，当前排期保持不变。');
        } else if (actionType === 'view_postmortem') {
          const report = await getPostMortemByProjectId(project.id);
          await sendUserCard(msg.userId, {
            title: '项目复盘摘要',
            content: report
              ? `排期准确率：${report.scheduleAccuracy ?? '--'}\n工时准确率：${report.estimateAccuracy ?? '--'}\n关键教训：${report.lessonsLearned[0] ?? '无'}`
              : '当前项目还没有生成复盘报告。'
          });
        }

        return Response.json({}, { status: 200 });
      }

      const text = msg.text ?? '';
      const isAddressed = msg.type === 'enter_session' || text.includes(`@${botName}`);
      if (!isAddressed) {
        return Response.json({}, { status: 200 });
      }

      const parsed = parseIntentFn(text);
      await enqueue(
        createMessage(
          'zhongshui',
          'request',
          {
            intent: parsed.intent,
            params: {
              ...parsed.params,
              text
            },
            project_id: project.id
          },
          project,
          getIntentPriority(parsed.intent),
          now()
        )
      );

      return Response.json({}, { status: 200 });
    }
  };
}

const handlers = createWeComWebhookHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
