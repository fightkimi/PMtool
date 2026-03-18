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

type WeComMessageHandlerDeps = Omit<WeComWebhookDeps, 'parseIncoming' | 'token'>;

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

function stripMention(text: string, botName: string): string {
  return text
    .replaceAll(`@${botName}`, '')
    .replace(/^@\S+\s*/, '')
    .trim();
}

function isAddressedMessage(text: string, botName: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes(`@${botName}`)) {
    return true;
  }

  const leadingMention = trimmed.match(/^@([^\s]+)/)?.[1] ?? '';
  if (!leadingMention) {
    return false;
  }

  if (leadingMention === botName || leadingMention === '助手') {
    return true;
  }

  return leadingMention.endsWith('助手');
}

function isGreeting(text: string, botName: string): boolean {
  const normalized = stripMention(text, botName).replace(/\s+/g, '').toLowerCase();
  return ['你好', '您好', 'hi', 'hello', '在吗', '在嘛', '嗨'].includes(normalized);
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
  const handleIncomingMessage = createWeComMessageHandler(deps);
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
      await handleIncomingMessage(msg, botName);

      return Response.json({}, { status: 200 });
    }
  };
}

export function createWeComMessageHandler(deps: WeComMessageHandlerDeps = {}) {
  const parseIntentFn = deps.parseIntent ?? parseIntent;
  const enqueue = deps.enqueue ?? ((message: AgentMessage) => agentQueue.enqueue(message));
  const getProjectByGroupId = deps.getProjectByGroupId ?? defaultGetProjectByGroupId;
  const rejectChangeRequest = deps.rejectChangeRequest ?? defaultRejectChangeRequest;
  const getPostMortemByProjectId = deps.getPostMortemByProjectId ?? defaultGetPostMortemByProjectId;
  const sendGroupMarkdown = deps.sendGroupMarkdown ?? defaultSendGroupMarkdown;
  const sendUserCard = deps.sendUserCard ?? defaultSendUserCard;
  const now = deps.now ?? (() => new Date());

  return async function handleIncomingMessage(msg: IncomingMessage, botName = process.env.WECOM_BOT_NAME ?? '助手') {
    console.info(
      '[WeComRoute] 收到消息:',
      JSON.stringify({
        type: msg.type,
        userId: msg.userId,
        groupId: msg.groupId,
        text: msg.text
      })
    );

    const project = await getProjectByGroupId(msg.groupId);
    if (!project) {
      console.warn(`[WeComRoute] 未找到群 ${msg.groupId} 对应的项目配置`);
      return;
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

      return;
    }

    const text = msg.text ?? '';
    const isAddressed = msg.type === 'enter_session' || isAddressedMessage(text, botName);
    if (!isAddressed) {
      console.info(`[WeComRoute] 消息未 @${botName}，忽略`);
      return;
    }

    const parsed = parseIntentFn(text);
    if (parsed.intent === 'unknown' && isGreeting(text, botName)) {
      await sendGroupMarkdown(
        project,
        `你好，我是${botName}。\n\n可以直接 @我 这样说：\n- 分析需求：登录流程优化\n- 本周进度怎么样\n- 有没有风险\n- 这个需求要延期，帮我评估变更\n- 做个项目复盘`
      );
      return;
    }

    console.info(
      '[WeComRoute] 识别意图:',
      JSON.stringify({
        intent: parsed.intent,
        params: parsed.params,
        projectId: project.id
      })
    );
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
  };
}

const handlers = createWeComWebhookHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
