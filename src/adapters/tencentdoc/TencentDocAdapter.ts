import type { DocAdapter, DocField, DocFilter, DocRecord, TencentDocAdapterConfig } from '@/adapters/types';

const MAX_BATCH_SIZE = 100;

export class TencentDocAdapter implements DocAdapter {
  private readonly fetcher: typeof fetch;
  private readonly webhookSchemas: Record<string, Record<string, string>>;

  constructor(config: TencentDocAdapterConfig = {}) {
    this.fetcher = config.fetcher ?? fetch;
    this.webhookSchemas = (config.webhookSchemas ?? {}) as Record<string, Record<string, string>>;
  }

  async readTable(_webhookUrl: string, _filter?: DocFilter): Promise<DocRecord[]> {
    console.info('[TencentDoc] Webhook 模式不支持 readTable，已返回空数组');
    return [];
  }

  async createRecord(webhookUrl: string, fields: DocRecord): Promise<string> {
    const schema = this.getWebhookSchema(webhookUrl);
    const response = await this.fetcher(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        add_records: [{ values: this.buildValues(fields, schema) }]
      })
    });
    const data = await this.assertWebhookSuccess(response, 'createRecord');
    return this.extractRecordId(data.add_records?.[0]);
  }

  async updateRecord(webhookUrl: string, recordId: string, fields: Partial<DocRecord>): Promise<void> {
    await this.batchUpdate(webhookUrl, [{ id: recordId, fields }]);
  }

  async batchUpdate(
    webhookUrl: string,
    updates: Array<{ id: string; fields: Partial<DocRecord> }>
  ): Promise<void> {
    const schema = this.getWebhookSchema(webhookUrl);
    for (let index = 0; index < updates.length; index += MAX_BATCH_SIZE) {
      const chunk = updates.slice(index, index + MAX_BATCH_SIZE);
      const response = await this.fetcher(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          update_records: chunk.map((item) => ({
            record_id: item.id,
            values: this.buildValues(item.fields, schema)
          }))
        })
      });
      await this.assertWebhookSuccess(response, 'batchUpdate');
    }
  }

  async findRecord(_webhookUrl: string, _field: string, _value: string): Promise<DocRecord | null> {
    console.info('[TencentDoc] Webhook 模式不支持 findRecord，已返回 null');
    return null;
  }

  async createTable(_rootId: string, _name: string, _fields: DocField[]): Promise<string> {
    throw new Error('Webhook 模式不支持自动创建智能表格，请在企业微信智能表格中手动开启“接收外部数据”并配置 Webhook。');
  }

  buildValues(fields: Partial<DocRecord>, schema: Record<string, string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const nameToId = Object.fromEntries(Object.entries(schema).map(([id, name]) => [name, id]));

    for (const [key, value] of Object.entries(fields)) {
      if (value == null) {
        continue;
      }

      const fieldId = nameToId[key] ?? key;
      if (typeof value === 'number') {
        result[fieldId] = value;
        continue;
      }

      if (typeof value === 'boolean') {
        result[fieldId] = value ? 1 : 0;
        continue;
      }

      if (typeof value === 'string') {
        result[fieldId] = /^\d{13}$/.test(value) ? value : [{ text: value }];
      }
    }

    return result;
  }

  static clearTokenCache() {
    // no-op: webhook mode does not use access_token
  }

  private getWebhookSchema(webhookUrl: string): Record<string, string> {
    return this.webhookSchemas[webhookUrl] ?? this.webhookSchemas.default ?? {};
  }

  private extractRecordId(record: unknown): string {
    if (record && typeof record === 'object' && 'record_id' in record && typeof record.record_id === 'string') {
      return record.record_id;
    }

    return '';
  }

  private async assertWebhookSuccess(response: Response, action: string): Promise<Record<string, any>> {
    let data: Record<string, any> = {};
    try {
      data = (await response.json()) as Record<string, any>;
    } catch {
      data = {};
    }

    if (!response.ok) {
      const detail = data.errmsg ? `: ${data.errmsg}` : '';
      throw new Error(`[TencentDoc:${action}] HTTP ${response.status} ${response.statusText}${detail}`);
    }

    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      throw new Error(`智能表格写入失败: ${data.errmsg ?? `errcode=${data.errcode}`}`);
    }

    return data;
  }
}
