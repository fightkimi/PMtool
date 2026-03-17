import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubAdapter } from '@/adapters/github/GitHubAdapter';

const listCommits = vi.fn();
const listForRepo = vi.fn();
const update = vi.fn();
const pullsGet = vi.fn();
const listReviews = vi.fn();
const listForRef = vi.fn();
const createComment = vi.fn();
const create = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      listCommits
    },
    issues: {
      listForRepo,
      update,
      createComment,
      create
    },
    pulls: {
      get: pullsGet,
      listReviews
    },
    checks: {
      listForRef
    }
  }))
}));

describe('GitHubAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps recent commits into normalized commit objects', async () => {
    listCommits.mockResolvedValue({
      data: [
        {
          sha: 'a1',
          commit: {
            message: 'feat: first',
            author: {
              name: 'kimi',
              date: '2026-03-17T00:00:00.000Z'
            }
          }
        },
        {
          sha: 'b2',
          commit: {
            message: 'fix: second',
            author: {
              name: 'lee',
              date: '2026-03-16T00:00:00.000Z'
            }
          }
        },
        {
          sha: 'c3',
          commit: {
            message: 'chore: third',
            author: {
              name: 'sun',
              date: '2026-03-15T00:00:00.000Z'
            }
          }
        }
      ]
    });

    const adapter = new GitHubAdapter('token');
    const commits = await adapter.getRecentCommits('fightkimi/PMtool', 3);

    expect(commits).toHaveLength(3);
    expect(commits[0]).toEqual(
      expect.objectContaining({
        hash: 'a1',
        message: 'feat: first',
        author: 'kimi'
      })
    );
  });

  it('returns merged pull request status details', async () => {
    pullsGet.mockResolvedValue({
      data: {
        state: 'closed',
        merged: true,
        mergeable: true,
        head: {
          sha: 'head-sha'
        }
      }
    });
    listReviews.mockResolvedValue({
      data: [{ state: 'APPROVED' }, { state: 'COMMENTED' }]
    });
    listForRef.mockResolvedValue({
      data: {
        check_runs: [{ name: 'test' }, { name: 'build' }]
      }
    });

    const adapter = new GitHubAdapter('token');
    const status = await adapter.getPRStatus('fightkimi/PMtool', 12);

    expect(status.state).toBe('closed');
    expect(status.mergeable).toBe(true);
    expect(status.head_sha).toBe('head-sha');
  });

  it('appends watermark when adding issue comment', async () => {
    createComment.mockResolvedValue({});
    const adapter = new GitHubAdapter('token');

    await adapter.addIssueComment('fightkimi/PMtool', 1, '这是评论');

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('<!-- gw-pm-agent -->')
      })
    );
  });

  it('passes title and labels when creating issue', async () => {
    create.mockResolvedValue({
      data: {
        number: 1,
        title: '新问题',
        body: '内容',
        state: 'open',
        assignee: null,
        labels: [{ name: 'bug' }],
        created_at: '2026-03-17T00:00:00.000Z',
        updated_at: '2026-03-17T00:00:00.000Z'
      }
    });

    const adapter = new GitHubAdapter('token');
    await adapter.createIssue('fightkimi/PMtool', {
      title: '新问题',
      body: '内容',
      labels: ['bug']
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新问题',
        labels: ['bug']
      })
    );
  });

  it('filters pull requests out of issue list and normalizes labels', async () => {
    listForRepo.mockResolvedValue({
      data: [
        {
          number: 1,
          title: '真正的 issue',
          body: 'body',
          state: 'open',
          assignee: { login: 'kimi' },
          labels: [{ name: 'bug' }, 'urgent'],
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-18T00:00:00.000Z'
        },
        {
          number: 2,
          title: 'pull request shadow',
          body: '',
          state: 'open',
          assignee: null,
          labels: [],
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-18T00:00:00.000Z',
          pull_request: {}
        }
      ]
    });

    const adapter = new GitHubAdapter('token');
    const issues = await adapter.getIssues('fightkimi/PMtool', {
      state: 'open',
      labels: ['bug']
    });

    expect(listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'fightkimi',
        repo: 'PMtool',
        labels: 'bug'
      })
    );
    expect(issues).toEqual([
      expect.objectContaining({
        number: 1,
        assignee: 'kimi',
        labels: ['bug', 'urgent']
      })
    ]);
  });

  it('maps updateIssue payload into Octokit issue update params', async () => {
    update.mockResolvedValue({});
    const adapter = new GitHubAdapter('token');

    await adapter.updateIssue('fightkimi/PMtool', 7, {
      state: 'closed',
      labels: ['backend'],
      assignee: 'dev-a',
      title: '已修复',
      body: 'closing'
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 7,
        state: 'closed',
        labels: ['backend'],
        assignees: ['dev-a'],
        title: '已修复',
        body: 'closing'
      })
    );
  });
});
