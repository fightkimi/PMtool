import { Octokit } from '@octokit/rest';
import type { CodeAdapter, Commit, CreateIssueData, Issue, IssueFilter, PRStatus } from '@/adapters/types';

function parseRepo(repo: string) {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  return { owner, repo: name };
}

export class GitHubAdapter implements CodeAdapter {
  private readonly octokit: Octokit;

  constructor(token = process.env.GITHUB_TOKEN) {
    this.octokit = new Octokit({
      auth: token,
      throttle: {
        onRateLimit: (_retryAfter: number, options: { method?: string; url?: string }, octokit: { rateLimit?: { remaining?: number } }) => {
          if ((octokit.rateLimit?.remaining ?? 0) < 100) {
            console.warn(`GitHub rate limit is low for ${options.method ?? 'GET'} ${options.url ?? ''}`);
          }
          return false;
        }
      }
    } as ConstructorParameters<typeof Octokit>[0]);
  }

  async getRecentCommits(repo: string, limit: number): Promise<Commit[]> {
    const parsed = parseRepo(repo);
    const response = await this.octokit.repos.listCommits({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: limit
    });

    return response.data.map((commit) => ({
      hash: commit.sha,
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name ?? undefined,
      timestamp: commit.commit.author?.date ? new Date(commit.commit.author.date) : undefined,
      committedAt: commit.commit.author?.date ?? undefined,
      filesChanged: Array.isArray((commit as { files?: unknown[] }).files) ? (commit as { files?: unknown[] }).files?.length ?? 0 : 0
    }));
  }

  async getIssues(repo: string, filter: IssueFilter): Promise<Issue[]> {
    const parsed = parseRepo(repo);
    const response = await this.octokit.issues.listForRepo({
      owner: parsed.owner,
      repo: parsed.repo,
      state: filter.state,
      assignee: filter.assignee,
      labels: filter.labels?.join(','),
      since: filter.since?.toISOString()
    });

    return response.data
      .filter((issue) => !('pull_request' in issue))
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: issue.state as 'open' | 'closed',
        assignee: issue.assignee?.login ?? null,
        labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name ?? '')).filter(Boolean),
        created_at: issue.created_at ? new Date(issue.created_at) : undefined,
        updated_at: issue.updated_at ? new Date(issue.updated_at) : undefined
      }));
  }

  async updateIssue(repo: string, number: number, data: Partial<Issue>): Promise<void> {
    const parsed = parseRepo(repo);
    await this.octokit.issues.update({
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: number,
      state: data.state,
      labels: data.labels,
      assignees: data.assignee ? [data.assignee] : undefined,
      title: data.title,
      body: data.body
    });
  }

  async getPRStatus(repo: string, number: number): Promise<PRStatus> {
    const parsed = parseRepo(repo);
    const prResponse = await this.octokit.pulls.get({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: number
    });
    const [reviewsResponse, checksResponse] = await Promise.all([
      this.octokit.pulls.listReviews({
        owner: parsed.owner,
        repo: parsed.repo,
        pull_number: number
      }),
      this.octokit.checks.listForRef({
        owner: parsed.owner,
        repo: parsed.repo,
        ref: prResponse.data.head.sha
      }).catch(() => ({
        data: {
          check_runs: []
        }
      }))
    ]);

    return {
      state: prResponse.data.state as 'open' | 'closed' | 'merged',
      mergeable: prResponse.data.mergeable,
      reviews: reviewsResponse.data.map((review) => review.state),
      checks: checksResponse.data.check_runs.map((check) => check.name),
      head_sha: prResponse.data.head.sha
    };
  }

  async addIssueComment(repo: string, number: number, body: string): Promise<void> {
    const parsed = parseRepo(repo);
    await this.octokit.issues.createComment({
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: number,
      body: `${body}\n\n<!-- gw-pm-agent -->`
    });
  }

  async createIssue(repo: string, data: CreateIssueData): Promise<Issue> {
    const parsed = parseRepo(repo);
    const response = await this.octokit.issues.create({
      owner: parsed.owner,
      repo: parsed.repo,
      title: data.title,
      body: data.body,
      labels: data.labels,
      assignees: data.assignees
    });

    return {
      number: response.data.number,
      title: response.data.title,
      body: response.data.body ?? '',
      state: response.data.state as 'open' | 'closed',
      assignee: response.data.assignee?.login ?? null,
      labels: response.data.labels.map((label) => (typeof label === 'string' ? label : label.name ?? '')).filter(Boolean),
      created_at: response.data.created_at ? new Date(response.data.created_at) : undefined,
      updated_at: response.data.updated_at ? new Date(response.data.updated_at) : undefined
    };
  }
}
