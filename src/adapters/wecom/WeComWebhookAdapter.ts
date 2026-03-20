import { createDecipheriv, createHash } from 'node:crypto';
import type { IMAdapter, IMCard, IMMessage, IMUser, IncomingMessage, WeComAdapterConfig } from '@/adapters/types';
import { agentLogger } from '@/workers/logger';

type TokenCacheValue = {
  token: string;
  expiresAt: number;
};

type WeComApiResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
  memberlist?: Array<{ userid?: string; name?: string; email?: string }>;
};

type WeComIncomingPayload =
  | string
  | {
      xml?: string;
      Encrypt?: string;
      msg_signature?: string;
      timestamp?: string;
      nonce?: string;
    };

const DEFAULT_BASE_URL = 'https://qyapi.weixin.qq.com';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 10000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  backoffMs = 1000
): Promise<T | undefined> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`withRetry attempt ${attempt} failed`, error);

      if (attempt < maxRetries) {
        const delayMs =
          backoffMs === 0
            ? 0
            : DEFAULT_RETRY_DELAYS_MS[Math.min(attempt - 1, DEFAULT_RETRY_DELAYS_MS.length - 1)] ?? backoffMs;
        await sleep(delayMs);
      }
    }
  }

  console.error('withRetry exhausted retries', lastError);
  return undefined;
}

function extractXmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>|<${tag}>(.*?)<\\/${tag}>`));
  return match?.[1] ?? match?.[2];
}

export class WeComWebhookAdapter implements IMAdapter {
  private static tokenCache = new Map<string, TokenCacheValue>();

  private config: WeComAdapterConfig;

  private fetcher: typeof fetch;

  constructor(config: WeComAdapterConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL
    };
    this.fetcher = config.fetcher ?? fetch;
  }

  async sendMessage(groupId: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      return;
    }

    await this.postAppMessage(token, {
      chatid: groupId,
      msgtype: 'text',
      text: { content: text }
    });
  }

  async sendMarkdown(groupId: string, markdown: string): Promise<void> {
    agentLogger.wecom(groupId, 'markdown', markdown);
    const token = await this.getAccessToken();
    if (!token) {
      return;
    }

    await this.postAppMessage(token, {
      chatid: groupId,
      msgtype: 'markdown',
      markdown: { content: markdown }
    });
  }

  async sendCard(groupId: string, card: IMCard): Promise<void> {
    agentLogger.wecom(groupId, 'card', JSON.stringify(card));
    const token = await this.getAccessToken();
    if (!token) {
      return;
    }

    await this.postAppMessage(token, {
      chatid: groupId,
      msgtype: 'textcard',
      textcard: {
        title: card.title,
        description: card.content,
        url: 'https://work.weixin.qq.com',
        btntxt: card.buttons?.[0]?.text ?? '查看'
      }
    });
  }

  async sendDM(userId: string, content: IMMessage): Promise<void> {
    agentLogger.wecom(userId, 'dm', JSON.stringify(content));
    const token = await this.getAccessToken();
    if (!token) {
      return;
    }

    const body =
      content.type === 'text'
        ? {
            touser: userId,
            msgtype: 'text',
            agentid: Number(this.config.agentId ?? 0),
            text: { content: content.text }
          }
        : {
            touser: userId,
            msgtype: 'markdown',
            agentid: Number(this.config.agentId ?? 0),
            markdown: { content: `**${content.card.title}**\n${content.card.content}` }
          };

    await withRetry(async () => {
      const response = await this.fetcher(`${this.config.baseUrl}/cgi-bin/message/send?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await this.assertWeComSuccess(response, 'message/send', {
        touser: userId,
        msgtype: String(body.msgtype ?? '')
      });
    });
  }

  async parseIncoming(payload: unknown): Promise<IncomingMessage | null> {
    const source = payload as WeComIncomingPayload;
    const xml = await this.resolveXml(source);
    if (!xml) {
      return null;
    }

    const rawType = extractXmlValue(xml, 'MsgType') ?? extractXmlValue(xml, 'Event');
    const content = extractXmlValue(xml, 'Content');
    const eventKey = extractXmlValue(xml, 'EventKey');
    const userId = extractXmlValue(xml, 'FromUserName');
    const groupId = extractXmlValue(xml, 'ChatId') ?? extractXmlValue(xml, 'FromUserName');

    if (!userId || !groupId) {
      return null;
    }

    let type: IncomingMessage['type'] = 'text';
    if (eventKey || rawType === 'click') {
      type = 'button_click';
    } else if (rawType === 'enter_session' || rawType === 'enter_agent') {
      type = 'enter_session';
    }

    return {
      type,
      userId,
      groupId,
      text: content,
      buttonAction: eventKey,
      rawPayload: payload
    };
  }

  async getGroupMembers(groupId: string): Promise<IMUser[]> {
    const token = await this.getAccessToken();
    if (!token) {
      return [];
    }

    const response = await this.fetcher(
      `${this.config.baseUrl}/cgi-bin/appchat/get?chatid=${encodeURIComponent(groupId)}&access_token=${token}`
    );
    const data = (await response.json()) as WeComApiResponse;

    return (data.memberlist ?? []).map((member) => ({
      userId: member.userid ?? '',
      name: member.name ?? member.userid ?? '',
      email: member.email
    }));
  }

  getConnectionStatus() {
    return {
      connected: true,
      mode: 'webhook' as const,
      detail: 'Webhook 模式无持久连接'
    };
  }

  private async postAppMessage(accessToken: string, body: Record<string, unknown>): Promise<void> {
    const hasChatId = typeof body.chatid === 'string' && body.chatid.length > 0;
    const endpoint = hasChatId ? 'appchat/send' : 'message/send';
    const url = `${this.config.baseUrl}/cgi-bin/${endpoint}?access_token=${accessToken}`;

    await withRetry(async () => {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await this.assertWeComSuccess(response, endpoint, {
        chatid: typeof body.chatid === 'string' ? body.chatid : undefined,
        msgtype: String(body.msgtype ?? '')
      });
    });
  }

  private async assertWeComSuccess(
    response: Response,
    endpoint: string,
    meta?: { chatid?: string; touser?: string; msgtype?: string }
  ): Promise<void> {
    let data: WeComApiResponse | null = null;
    try {
      data = (await response.json()) as WeComApiResponse;
    } catch {
      if (!response.ok) {
        throw new Error(`[WeComWebhook:${endpoint}] HTTP ${response.status} ${response.statusText}`);
      }
      return;
    }

    if (!response.ok) {
      throw new Error(
        `[WeComWebhook:${endpoint}] HTTP ${response.status} ${response.statusText}: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    if ((data.errcode ?? 0) !== 0) {
      throw new Error(
        `[WeComWebhook:${endpoint}] errcode=${data.errcode} errmsg=${data.errmsg ?? 'unknown'}`
      );
    }

    console.info(
      `[WeComWebhook:${endpoint}] ok`,
      JSON.stringify({
        chatid: meta?.chatid,
        touser: meta?.touser,
        msgtype: meta?.msgtype
      })
    );
  }

  private getTokenCacheKey(): string {
    return `${this.config.corpId ?? ''}:${this.config.agentSecret ?? ''}`;
  }

  private async getAccessToken(): Promise<string | undefined> {
    const cacheKey = this.getTokenCacheKey();
    const cached = WeComWebhookAdapter.tokenCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      return cached.token;
    }

    if (!this.config.corpId || !this.config.agentSecret) {
      return undefined;
    }

    const response = await this.fetcher(
      `${this.config.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.agentSecret)}`
    );
    const data = (await response.json()) as WeComApiResponse;

    if ((data.errcode ?? 0) !== 0 || !data.access_token) {
      return undefined;
    }

    const expiresInMs = (data.expires_in ?? TOKEN_TTL_MS / 1000) * 1000;
    WeComWebhookAdapter.tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: now + expiresInMs
    });

    return data.access_token;
  }

  private async resolveXml(payload: WeComIncomingPayload): Promise<string | null> {
    if (typeof payload === 'string') {
      return payload;
    }

    if (payload?.xml) {
      return payload.xml;
    }

    const encrypted = payload?.Encrypt;
    if (!encrypted) {
      return null;
    }

    if (!this.verifySignature(payload)) {
      return null;
    }

    return this.decrypt(encrypted);
  }

  private verifySignature(payload: Exclude<WeComIncomingPayload, string>): boolean {
    const { msg_signature: signature, timestamp, nonce } = payload;
    if (!signature || !timestamp || !nonce || !this.config.botToken) {
      return true;
    }

    const digest = createHash('sha1')
      .update([this.config.botToken, timestamp, nonce].sort().join(''))
      .digest('hex');

    return digest === signature;
  }

  private decrypt(encrypted: string): string | null {
    if (!this.config.botAesKey) {
      return null;
    }

    const aesKey = Buffer.from(`${this.config.botAesKey}=`, 'base64');
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
    const pad = decrypted[decrypted.length - 1] ?? 0;
    const unpadded = decrypted.subarray(0, decrypted.length - pad);
    const msgLength = unpadded.readUInt32BE(16);
    const xml = unpadded.subarray(20, 20 + msgLength).toString('utf8');

    return xml || null;
  }

  static clearTokenCache() {
    WeComWebhookAdapter.tokenCache.clear();
  }

  static inspectTokenCache(key: string) {
    return WeComWebhookAdapter.tokenCache.get(key);
  }
}
