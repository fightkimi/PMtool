import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GiteeAdapter } from '@/adapters/github/GiteeAdapter';

const fetcher = vi.fn<typeof fetch>();

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('GiteeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps recent commits into normalized commit objects', async () => {
    fetcher.mockResolvedValueOnce(
      jsonResponse([
        {
          sha: 'a1',
          commit: {
            message: 'feat: first',
            author: {
              name: 'kimi',
              date: '2026-03-17T00:00:00.000Z'
            }
          }
        }
      ])
    );

    const adapter = new GiteeAdapter({ token: 'token', fetcher });
    const commits = await adapter.getRecentCommits('fightkimi/PMtool', 3);

    expect(commits).toEqual([
      expect.objectContaining({
        hash: 'a1',
        message: 'feat: first',
        author: 'kimi'
      })
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/repos/fightkimi/PMtool/commits');
  });

  it('normalizes issue list and forwards filters', async () => {
    fetcher.mockResolvedValueOnce(
      jsonResponse([
        {
          number: 1,
          title: '真正的 issue',
          body: 'body',
          state: 'open',
          assignee: { name: 'kimi' },
          labels: [{ name: 'bug' }, 'urgent'],
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-18T00:00:00.000Z'
        }
      ])
    );

    const adapter = new GiteeAdapter({ token: 'token', fetcher });
    const issues = await adapter.getIssues('fightkimi/PMtool', {
      state: 'open',
      labels: ['bug']
    });

    expect(issues).toEqual([
      expect.objectContaining({
        number: 1,
        assignee: 'kimi',
        labels: ['bug', 'urgent']
      })
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain('labels=bug');
  });

  it('maps updateIssue payload into Gitee issue update params', async () => {
    fetcher.mockResolvedValueOnce(jsonResponse({}));
    const adapter = new GiteeAdapter({ token: 'token', fetcher });

    await adapter.updateIssue('fightkimi/PMtool', 7, {
      state: 'closed',
      labels: ['backend'],
      assignee: 'dev-a',
      title: '已修复',
      body: 'closing'
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      state: 'closed',
      labels: 'backend',
      assignee: 'dev-a',
      title: '已修复',
      body: 'closing'
    });
  });

  it('returns pull request status details', async () => {
    fetcher
      .mockResolvedValueOnce(
        jsonResponse({
          state: 'merged',
          mergeable: true,
          head: { sha: 'head-sha' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { user: { name: 'reviewer-a' } },
          { user: { name: 'reviewer-b' } }
        ])
      );

    const adapter = new GiteeAdapter({ token: 'token', fetcher });
    const status = await adapter.getPRStatus('fightkimi/PMtool', 12);

    expect(status).toEqual({
      state: 'merged',
      mergeable: true,
      reviews: ['reviewer-a', 'reviewer-b'],
      checks: [],
      head_sha: 'head-sha'
    });
  });

  it('appends watermark when adding issue comment', async () => {
    fetcher.mockResolvedValueOnce(jsonResponse({}));
    const adapter = new GiteeAdapter({ token: 'token', fetcher });

    await adapter.addIssueComment('fightkimi/PMtool', 3, 'hello');

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      body: 'hello\n\n<!-- gw-pm-agent -->'
    });
  });

  it('passes title and labels when creating issue', async () => {
    fetcher.mockResolvedValueOnce(
      jsonResponse({
        number: 1,
        title: '新问题',
        body: '内容',
        state: 'open',
        assignee: { name: 'kimi' },
        labels: [{ name: 'bug' }],
        created_at: '2026-03-17T00:00:00.000Z',
        updated_at: '2026-03-17T00:00:00.000Z'
      })
    );

    const adapter = new GiteeAdapter({ token: 'token', fetcher });
    const issue = await adapter.createIssue('fightkimi/PMtool', {
      title: '新问题',
      body: '内容',
      labels: ['bug'],
      assignees: ['kimi']
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      title: '新问题',
      body: '内容',
      labels: 'bug',
      assignee: 'kimi'
    });
    expect(issue).toEqual(
      expect.objectContaining({
        number: 1,
        assignee: 'kimi',
        labels: ['bug']
      })
    );
  });
});
