import type { CodeAdapter, Commit, CreateIssueData, Issue, IssueFilter, PRStatus } from '@/adapters/types';

type GiteeAdapterConfig = {
  token?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type JsonRecord = Record<string, any>;

const DEFAULT_BASE_URL = 'https://gitee.com/api/v5';

function parseRepo(repo: string) {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  return { owner, repo: name };
}

export class GiteeAdapter implements CodeAdapter {
  private readonly token?: string;

  private readonly baseUrl: string;

  private readonly fetcher: typeof fetch;

  constructor(config: GiteeAdapterConfig = {}) {
    this.token = config.token ?? process.env.GITEE_TOKEN;
    this.baseUrl = config.baseUrl ?? process.env.GITEE_API_BASE ?? DEFAULT_BASE_URL;
    this.fetcher = config.fetcher ?? fetch;
  }

  async getRecentCommits(repo: string, limit: number): Promise<Commit[]> {
    const parsed = parseRepo(repo);
    const response = await this.request<JsonRecord[]>(
      `/repos/${parsed.owner}/${parsed.repo}/commits`,
      {
        per_page: String(limit)
      }
    );

    return response.map((commit) => ({
      hash: commit.sha,
      sha: commit.sha,
      message: commit.commit?.message ?? '',
      author: commit.commit?.author?.name ?? commit.author?.name ?? undefined,
      timestamp: commit.commit?.author?.date ? new Date(commit.commit.author.date) : undefined,
      committedAt: commit.commit?.author?.date ?? undefined
    }));
  }

  async getIssues(repo: string, filter: IssueFilter): Promise<Issue[]> {
    const parsed = parseRepo(repo);
    const response = await this.request<JsonRecord[]>(
      `/repos/${parsed.owner}/${parsed.repo}/issues`,
      {
        state: filter.state,
        assignee: filter.assignee,
        labels: filter.labels?.join(','),
        since: filter.since?.toISOString()
      }
    );

    return response.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      state: issue.state as 'open' | 'closed',
      assignee: issue.assignee?.login ?? issue.assignee?.name ?? null,
      labels: Array.isArray(issue.labels)
        ? issue.labels
            .map((label: unknown) =>
              typeof label === 'string' ? label : (label as { name?: string })?.name ?? ''
            )
            .filter(Boolean)
        : [],
      created_at: issue.created_at ? new Date(issue.created_at) : undefined,
      updated_at: issue.updated_at ? new Date(issue.updated_at) : undefined
    }));
  }

  async updateIssue(repo: string, number: number, data: Partial<Issue>): Promise<void> {
    const parsed = parseRepo(repo);
    await this.request(
      `/repos/${parsed.owner}/${parsed.repo}/issues/${number}`,
      {},
      {
        method: 'PATCH',
        body: {
          state: data.state,
          labels: data.labels?.join(','),
          assignee: data.assignee ?? undefined,
          title: data.title,
          body: data.body
        }
      }
    );
  }

  async getPRStatus(repo: string, number: number): Promise<PRStatus> {
    const parsed = parseRepo(repo);
    const [pull, comments] = await Promise.all([
      this.request<JsonRecord>(`/repos/${parsed.owner}/${parsed.repo}/pulls/${number}`),
      this.request<JsonRecord[]>(`/repos/${parsed.owner}/${parsed.repo}/pulls/${number}/comments`).catch(() => [])
    ]);

    return {
      state: pull.state as 'open' | 'closed' | 'merged',
      mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
      reviews: comments
        .map((comment) => comment.user?.name ?? comment.user?.login ?? '')
        .filter(Boolean),
      checks: [],
      head_sha: pull.head?.sha ?? ''
    };
  }

  async addIssueComment(repo: string, number: number, body: string): Promise<void> {
    const parsed = parseRepo(repo);
    await this.request(
      `/repos/${parsed.owner}/${parsed.repo}/issues/${number}/comments`,
      {},
      {
        method: 'POST',
        body: {
          body: `${body}\n\n<!-- gw-pm-agent -->`
        }
      }
    );
  }

  async createIssue(repo: string, data: CreateIssueData): Promise<Issue> {
    const parsed = parseRepo(repo);
    const response = await this.request<JsonRecord>(
      `/repos/${parsed.owner}/${parsed.repo}/issues`,
      {},
      {
        method: 'POST',
        body: {
          title: data.title,
          body: data.body,
          labels: data.labels?.join(','),
          assignee: data.assignees?.[0]
        }
      }
    );

    return {
      number: response.number,
      title: response.title,
      body: response.body ?? '',
      state: response.state as 'open' | 'closed',
      assignee: response.assignee?.login ?? response.assignee?.name ?? null,
      labels: Array.isArray(response.labels)
        ? response.labels
            .map((label: unknown) =>
              typeof label === 'string' ? label : (label as { name?: string })?.name ?? ''
            )
            .filter(Boolean)
        : [],
      created_at: response.created_at ? new Date(response.created_at) : undefined,
      updated_at: response.updated_at ? new Date(response.updated_at) : undefined
    };
  }

  private async request<T = JsonRecord>(
    path: string,
    query: Record<string, string | undefined> = {},
    init: { method?: string; body?: Record<string, unknown> } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    if (this.token) {
      url.searchParams.set('access_token', this.token);
    }

    const response = await this.fetcher(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    });

    const data = (await response.json().catch(() => ({}))) as JsonRecord;
    if (!response.ok) {
      const message = data.message ?? data.error_description ?? `${response.status} ${response.statusText}`;
      throw new Error(`Gitee API error: ${message}`);
    }

    return data as T;
  }
}
