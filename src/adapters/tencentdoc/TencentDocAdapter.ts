import type { DocAdapter, DocField, DocFilter, DocRecord, TencentDocAdapterConfig } from '@/adapters/types';

type TokenCacheValue = {
  token: string;
  expiresAt: number;
};

const DEFAULT_BASE_URL = 'https://docs.qq.com';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

type ColumnDef = { id: string; name: string };
type RowDef = { id?: string | number; rowId?: string | number; row_no?: string | number; cells?: Record<string, unknown> };

export class TencentDocAdapter implements DocAdapter {
  private static tokenCache = new Map<string, TokenCacheValue>();

  private config: TencentDocAdapterConfig;

  private fetcher: typeof fetch;

  constructor(config: TencentDocAdapterConfig) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      ...config
    };
    this.fetcher = config.fetcher ?? fetch;
  }

  async readTable(tableId: string, filter?: DocFilter): Promise<DocRecord[]> {
    const data = await this.request<{
      data?: {
        columns?: ColumnDef[];
        rows?: RowDef[];
        records?: Array<Record<string, unknown> | { fields?: Record<string, unknown> }>;
      };
    }>(`/openapi/sheetbook/v2/tables/${tableId}/records`, {
      method: 'GET'
    });

    const records = this.normalizeRecords(data);
    if (!filter) {
      return records;
    }

    return records.filter((record) => String(record[filter.field] ?? '') === filter.value);
  }

  async createRecord(tableId: string, fields: DocRecord): Promise<string> {
    const data = await this.request<{ data?: { row_no?: number | string; rowNo?: number | string; recordId?: string } }>(
      `/openapi/sheetbook/v2/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      }
    );

    const rowId = data.data?.recordId ?? data.data?.row_no ?? data.data?.rowNo;
    return String(rowId ?? '');
  }

  async updateRecord(tableId: string, recordId: string, fields: Partial<DocRecord>): Promise<void> {
    await this.request(`/openapi/sheetbook/v2/tables/${tableId}/records/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
  }

  async batchUpdate(tableId: string, updates: Array<{ id: string; fields: Partial<DocRecord> }>): Promise<void> {
    await this.request(`/openapi/sheetbook/v2/tables/${tableId}/records:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
  }

  async findRecord(tableId: string, field: string, value: string): Promise<DocRecord | null> {
    const records = await this.readTable(tableId, { field, value });
    return records[0] ?? null;
  }

  async createTable(rootId: string, name: string, fields: DocField[]): Promise<string> {
    const data = await this.request<{ data?: { tableId?: string; sheet_id?: string } }>(
      `/openapi/sheetbook/v2/files/${rootId}/sheets`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fields })
      }
    );

    return data.data?.tableId ?? data.data?.sheet_id ?? '';
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });

    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    const cacheKey = `${this.config.appId ?? ''}:${this.config.appSecret ?? ''}`;
    const cached = TencentDocAdapter.tokenCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      return cached.token;
    }

    const response = await this.fetcher(`${this.config.baseUrl}/openapi/authen/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appid: this.config.appId,
        appsecret: this.config.appSecret,
        grant_type: 'client_credential'
      })
    });
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    const token = data.access_token ?? '';
    TencentDocAdapter.tokenCache.set(cacheKey, {
      token,
      expiresAt: now + (data.expires_in ?? 7200) * 1000
    });

    return token;
  }

  private normalizeRecords(data: {
    data?: {
      columns?: ColumnDef[];
      rows?: RowDef[];
      records?: Array<Record<string, unknown> | { fields?: Record<string, unknown> }>;
    };
  }): DocRecord[] {
    const records = data.data?.records;
    if (records?.length) {
      return records.map((record) => {
        const rawFields = ('fields' in record ? record.fields ?? {} : record) as Record<string, unknown>;
        return this.normalizeRecord(rawFields);
      });
    }

    const columns = data.data?.columns ?? [];
    const rows = data.data?.rows ?? [];

    return rows.map((row) => {
      const cells = row.cells ?? {};
      const result: DocRecord = {};
      for (const column of columns) {
        result[column.name] = this.normalizeValue(cells[column.id]);
      }
      return result;
    });
  }

  private normalizeRecord(record: Record<string, unknown>): DocRecord {
    const result: DocRecord = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = this.normalizeValue(value);
    }
    return result;
  }

  private normalizeValue(value: unknown): string | number | boolean | null {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return value;
    }

    if (value == null) {
      return null;
    }

    if (typeof value === 'object' && 'value' in value) {
      return this.normalizeValue((value as { value: unknown }).value);
    }

    return String(value);
  }

  static clearTokenCache() {
    TencentDocAdapter.tokenCache.clear();
  }
}
