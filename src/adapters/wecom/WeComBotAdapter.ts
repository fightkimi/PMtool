import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { IMAdapter, IMCard, IMMessage, IMUser, IncomingMessage, WeComAdapterConfig } from '@/adapters/types';
import { agentLogger } from '@/workers/logger';

type BotSocketLike = {
  on: (event: string, listener: (...args: any[]) => void) => void;
  send: (data: string) => void;
  ping?: () => void;
  close: () => void;
  readyState?: number;
};

type WeComBotAdapterConfig = WeComAdapterConfig & {
  wsFactory?: (url: string) => BotSocketLike;
  heartbeatIntervalMs?: number;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
};

type SubscribeAckPayload = {
  cmd?: string;
  errcode?: number;
  errmsg?: string;
};

type BotEventPayload = {
  cmd?: string;
  headers?: {
    req_id?: string;
  };
  body?: {
    msgid?: string;
    aibotid?: string;
    chatid?: string;
    chattype?: 'group' | 'single';
    from?: {
      userid?: string;
    };
    msgtype?: 'text' | 'event';
    text?: {
      content?: string;
    };
    event?: {
      eventtype?: string;
      eventkey?: string;
    };
  };
};

type ReplyContext = {
  reqId?: string;
  aibotid?: string;
};

const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com';
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_MAX_RECONNECTS = 5;

function createSocket(url: string): BotSocketLike {
  return new WebSocket(url);
}

export class WeComBotAdapter implements IMAdapter {
  private readonly config: WeComBotAdapterConfig;

  private readonly wsFactory: (url: string) => BotSocketLike;

  private readonly listeners = new Set<(message: IncomingMessage) => Promise<void> | void>();

  private readonly replyContextByTarget = new Map<string, ReplyContext>();

  private socket: BotSocketLike | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private reconnectAttempts = 0;

  private reconnectScheduled = false;

  private started = false;

  constructor(config: WeComBotAdapterConfig = {}) {
    this.config = {
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectAttempts: DEFAULT_MAX_RECONNECTS,
      ...config
    };
    this.wsFactory = config.wsFactory ?? createSocket;
  }

  onMessage(listener: (message: IncomingMessage) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    const botId = this.config.botId ?? process.env.WECOM_BOT_ID;
    const secret = this.config.botSecret ?? process.env.WECOM_BOT_SECRET;

    if (!botId || !secret) {
      throw new Error('缺少 WECOM_BOT_ID 或 WECOM_BOT_SECRET');
    }

    this.started = true;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectScheduled = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  async sendMessage(groupId: string, text: string): Promise<void> {
    agentLogger.wecom(groupId, 'markdown', text);
    this.wsSend({
      cmd: 'aibot_send_msg',
      headers: { req_id: randomUUID() },
      body: {
        aibotid: this.getBotId(),
        chatid: groupId,
        msgtype: 'text',
        text: { content: text }
      }
    });
  }

  async sendMarkdown(groupId: string, markdown: string): Promise<void> {
    agentLogger.wecom(groupId, 'markdown', markdown);
    this.wsSend({
      cmd: 'aibot_send_msg',
      headers: { req_id: randomUUID() },
      body: {
        aibotid: this.getBotId(),
        chatid: groupId,
        msgtype: 'markdown',
        markdown: { content: markdown }
      }
    });
  }

  async sendCard(groupId: string, card: IMCard): Promise<void> {
    agentLogger.wecom(groupId, 'card', JSON.stringify(card));
    const buttonLines = card.buttons?.length
      ? `\n\n**可执行操作**\n${card.buttons.map((button, index) => `${index + 1}. ${button.text}`).join('\n')}`
      : '';

    const content = this.formatCardMarkdown(card);

    this.wsSend({
      cmd: 'aibot_send_msg',
      headers: { req_id: randomUUID() },
      body: {
        aibotid: this.getBotId(),
        chatid: groupId,
        msgtype: 'markdown',
        markdown: {
          content: `${content}${buttonLines}`
        }
      }
    });
  }

  async sendDM(userId: string, content: IMMessage): Promise<void> {
    agentLogger.wecom(userId, 'dm', JSON.stringify(content));
    this.wsSend({
      cmd: 'aibot_send_msg',
      headers: { req_id: randomUUID() },
      body: {
        aibotid: this.getBotId(),
        touserid: [userId],
        msgtype: 'text',
        text: {
          content: content.type === 'text' ? content.text : content.card.content
        }
      }
    });
  }

  async parseIncoming(payload: unknown): Promise<IncomingMessage | null> {
    const parsed = this.parsePayload(payload);
    const body = parsed && 'body' in parsed ? parsed.body : undefined;
    if (!body) {
      return null;
    }

    if (parsed?.cmd === 'aibot_event_callback') {
      const eventType = body.event?.eventtype;
      if (eventType !== 'enter_session') {
        return null;
      }

      return {
        type: 'enter_session',
        userId: body.from?.userid ?? '',
        groupId: body.chatid ?? body.from?.userid ?? '',
        rawPayload: payload
      };
    }

    if (parsed?.cmd !== 'aibot_msg_callback') {
      return null;
    }

    const userId = body.from?.userid ?? '';
    const groupId = body.chatid ?? userId;
    if (!userId || !groupId) {
      return null;
    }

    this.storeReplyContext(groupId, parsed);
    this.storeReplyContext(userId, parsed);

    const buttonAction = body.event?.eventkey;
    const type: IncomingMessage['type'] = buttonAction ? 'button_click' : 'text';

    return {
      type,
      userId,
      groupId,
      text: body.text?.content ?? '',
      buttonAction,
      rawPayload: payload
    };
  }

  async getGroupMembers(): Promise<IMUser[]> {
    return [];
  }

  static clearTokenCache() {
    // no-op: bot mode no longer depends on webhook adapter token cache
  }

  private async connect(): Promise<void> {
    const socket = this.wsFactory(DEFAULT_WS_URL);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let resolved = false;

      socket.on('open', () => {
        this.reconnectAttempts = 0;
        this.reconnectScheduled = false;
        this.startHeartbeat();
        console.info('[WeComBot] WebSocket 已连接，正在订阅...');
        this.sendCommand({
          cmd: 'aibot_subscribe',
          headers: { req_id: randomUUID() },
          body: {
            bot_id: this.getBotId(),
            secret: this.getBotSecret()
          }
        });
        resolved = true;
        resolve();
      });

      socket.on('message', (data: unknown) => {
        const raw = typeof data === 'string' ? data : data instanceof Buffer ? data.toString('utf8') : String(data ?? '');
        void this.handleSocketMessage(raw);
      });

      socket.on('close', (code?: number, reason?: Buffer | string) => {
        this.stopHeartbeat();
        this.socket = null;
        const reasonText =
          typeof reason === 'string' ? reason : reason instanceof Buffer ? reason.toString('utf8') : '';
        console.warn(`[WeComBot] 连接断开 code=${code ?? 0} reason=${reasonText || 'N/A'}，5秒后重连...`);
        if (this.started) {
          this.scheduleReconnect();
        }
      });

      socket.on('error', (error: unknown) => {
        console.error(
          '[WeComBot] WebSocket 错误:',
          error instanceof Error ? error.message : String(error)
        );
        if (!resolved) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    const parsed = this.parsePayload(raw);
    if (!parsed) {
      console.error('[WeComBot] 消息解析失败: 无法解析 JSON');
      return;
    }

    const body = 'body' in parsed ? parsed.body : undefined;

    if (parsed.cmd === 'aibot_event_callback') {
      const eventType = body?.event?.eventtype ?? 'unknown';
      console.info('[WeComBot] 事件:', eventType);
      if (eventType === 'disconnected_event') {
        this.stopHeartbeat();
        this.socket?.close();
      }
    } else if (parsed.cmd !== 'aibot_msg_callback') {
      console.info('[WeComBot] 收到响应:', parsed.cmd ?? 'unknown', JSON.stringify(parsed).slice(0, 200));
    } else {
      console.info(
        '[WeComBot] 收到消息回调:',
        JSON.stringify({
          chatid: body?.chatid,
          chattype: body?.chattype,
          from: body?.from?.userid,
          msgtype: body?.msgtype,
          text: body?.text?.content
        })
      );
    }

    const incoming = await this.parseIncoming(parsed);
    if (!incoming) {
      console.info('[WeComBot] 当前消息未转换为 IncomingMessage，已忽略');
      return;
    }

    console.info(
      '[WeComBot] 已解析 IncomingMessage:',
      JSON.stringify({
        type: incoming.type,
        userId: incoming.userId,
        groupId: incoming.groupId,
        text: incoming.text
      })
    );

    await Promise.allSettled(
      [...this.listeners].map((listener) => Promise.resolve(listener(incoming)))
    );
  }

  private parsePayload(payload: unknown): BotEventPayload | SubscribeAckPayload | null {
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload) as BotEventPayload | SubscribeAckPayload;
      } catch {
        return null;
      }
    }

    if (typeof payload === 'object' && payload !== null) {
      return payload as BotEventPayload | SubscribeAckPayload;
    }

    return null;
  }

  private buildRespondPayload(target: string, payload: { cmd: string; body: Record<string, unknown> }) {
    const context = this.replyContextByTarget.get(target);
    return {
      ...payload,
      headers: {
        req_id: context?.reqId ?? randomUUID()
      },
      body: {
        aibotid: context?.aibotid ?? this.getBotId(),
        ...payload.body
      }
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.ping?.();
      }
    }, this.config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectScheduled) {
      return;
    }
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECTS)) {
      return;
    }

    this.reconnectAttempts += 1;
    this.reconnectScheduled = true;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectScheduled = false;
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        console.error('WeCom bot reconnect failed', error);
        this.scheduleReconnect();
      });
    }, this.config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
  }

  private sendCommand(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('企业微信机器人 WebSocket 未连接');
    }

    this.socket.send(JSON.stringify(payload));
  }

  private wsSend(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('[WeComBot] WebSocket 未连接，无法发送消息');
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  private formatCardMarkdown(card: IMCard): string {
    const blocks = ['---', `# ${card.title}`];
    for (const lines of this.parseCardSections(card.content)) {
      const headingMatch = lines[0]?.match(/^(.+?)[：:]$/);
      if (headingMatch) {
        const heading = headingMatch[1];
        const items = lines.slice(1);
        blocks.push(this.formatCardSection(heading, items));
        continue;
      }

      blocks.push(lines.map((line) => `> ${line}`).join('\n'));
    }

    return blocks.join('\n\n');
  }

  private parseCardSections(content: string): string[][] {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const sections: string[][] = [];
    let current: string[] = [];

    for (const line of lines) {
      if (line.match(/^(.+?)[：:]$/) && current.length > 0) {
        sections.push(current);
        current = [line];
        continue;
      }

      current.push(line);
    }

    if (current.length > 0) {
      sections.push(current);
    }

    return sections;
  }

  private formatCardSection(heading: string, items: string[]): string {
    switch (heading) {
      case '审核结果': {
        const value = items[0] ?? '待确认';
        const label = value.includes('通过') && !value.includes('未') ? '✅ 通过' : '❌ 未通过';
        return `**🧾 审核结果**\n${label}`;
      }
      case '风险等级': {
        const value = items[0] ?? '待评估';
        const label = value.includes('高')
          ? '🔴 高风险'
          : value.includes('中')
            ? '🟡 中风险'
            : '🟢 低风险';
        return `**🚨 风险等级**\n${label}`;
      }
      case '问题':
        return this.formatOrderedBlock('⚠️ 主要问题', items);
      case '建议':
        return this.formatOrderedBlock('💡 修正建议', items);
      case '下一步':
        return this.formatOrderedBlock('👉 下一步怎么补充', items);
      default: {
        const body = items.length > 0 ? items.join('\n') : '暂无';
        return `**${heading}**\n${body}`;
      }
    }
  }

  private formatOrderedBlock(title: string, items: string[]): string {
    const normalizedItems = items.length > 0 ? items : ['暂无'];
    const numbered = normalizedItems.map((item, index) => {
      const stripped = item.replace(/^\d+\.\s*/, '').trim();
      return `${index + 1}. ${stripped}`;
    });
    return `**${title}**\n${numbered.join('\n')}`;
  }

  private storeReplyContext(target: string, payload: BotEventPayload | SubscribeAckPayload | null) {
    if (!payload || !('body' in payload) || !payload.body) {
      return;
    }

    this.replyContextByTarget.set(target, {
      reqId: payload.headers?.req_id,
      aibotid: payload.body.aibotid
    });
  }

  private getBotId(): string {
    return this.config.botId ?? process.env.WECOM_BOT_ID ?? '';
  }

  private getBotSecret(): string {
    return this.config.botSecret ?? process.env.WECOM_BOT_SECRET ?? '';
  }
}
