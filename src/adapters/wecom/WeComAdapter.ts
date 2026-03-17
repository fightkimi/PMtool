import { createDecipheriv, createHash } from 'node:crypto';
import type { IMAdapter, IMCard, IMMessage, IMUser, IncomingMessage, WeComAdapterConfig } from '@/adapters/types';

type TokenCacheValue = {
  token: string;
  expiresAt: number;
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
        await sleep(backoffMs * 2 ** (attempt - 1));
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

export class WeComAdapter implements IMAdapter {
  private static tokenCache = new Map<string, TokenCacheValue>();

  private config: WeComAdapterConfig;

  private fetcher: typeof fetch;

  constructor(config: WeComAdapterConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      ...config
    };
    this.fetcher = config.fetcher ?? fetch;
  }

  async sendMessage(groupId: string, text: string): Promise<void> {
    await this.postWebhook(groupId, {
      msgtype: 'text',
      text: { content: text }
    });
  }

  async sendMarkdown(groupId: string, markdown: string): Promise<void> {
    await this.postWebhook(groupId, {
      msgtype: 'markdown',
      markdown: { content: markdown }
    });
  }

  async sendCard(groupId: string, card: IMCard): Promise<void> {
    const lines = [`**${card.title}**`, card.content];
    if (card.buttons?.length) {
      lines.push('');
      lines.push(...card.buttons.map((button, index) => `${index + 1}. ${button.text}（回复：${button.action}）`));
    }

    await this.sendMarkdown(groupId, lines.join('\n'));
  }

  async sendDM(userId: string, content: IMMessage): Promise<void> {
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
      await this.fetcher(`${this.config.baseUrl}/cgi-bin/message/send?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
    const groupId = extractXmlValue(xml, 'ToUserName');

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
    const data = (await response.json()) as {
      memberlist?: Array<{ userid?: string; name?: string; email?: string }>;
    };

    return (data.memberlist ?? []).map((member) => ({
      userId: member.userid ?? '',
      name: member.name ?? member.userid ?? '',
      email: member.email
    }));
  }

  private resolveWebhook(groupId: string): string {
    return this.config.groupWebhookMap?.[groupId] ?? groupId;
  }

  private async postWebhook(groupId: string, body: Record<string, unknown>): Promise<void> {
    const webhookUrl = this.resolveWebhook(groupId);
    await withRetry(async () => {
      await this.fetcher(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    });
  }

  private getTokenCacheKey(): string {
    return `${this.config.corpId ?? ''}:${this.config.agentSecret ?? ''}`;
  }

  private async getAccessToken(): Promise<string | undefined> {
    const cacheKey = this.getTokenCacheKey();
    const cached = WeComAdapter.tokenCache.get(cacheKey);
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
    const data = (await response.json()) as { access_token?: string; expires_in?: number };

    if (!data.access_token) {
      return undefined;
    }

    const expiresInMs = (data.expires_in ?? TOKEN_TTL_MS / 1000) * 1000;
    WeComAdapter.tokenCache.set(cacheKey, {
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
    WeComAdapter.tokenCache.clear();
  }

  static inspectTokenCache(key: string) {
    return WeComAdapter.tokenCache.get(key);
  }
}
