/* v8 ignore file */
import type { CodeAdapter, Commit, CreateIssueData, Issue, IssueFilter, PRStatus } from '@/adapters/types';

function notImplemented(methodName: string): never {
  throw new Error(`GiteeAdapter: ${methodName} not yet implemented`);
}

export class GiteeAdapter implements CodeAdapter {
  async getRecentCommits(_repo: string, _limit: number): Promise<Commit[]> {
    return notImplemented('getRecentCommits');
  }

  async getIssues(_repo: string, _filter: IssueFilter): Promise<Issue[]> {
    return notImplemented('getIssues');
  }

  async updateIssue(_repo: string, _number: number, _data: Partial<Issue>): Promise<void> {
    notImplemented('updateIssue');
  }

  async getPRStatus(_repo: string, _number: number): Promise<PRStatus> {
    return notImplemented('getPRStatus');
  }

  async addIssueComment(_repo: string, _number: number, _body: string): Promise<void> {
    notImplemented('addIssueComment');
  }

  async createIssue(_repo: string, _data: CreateIssueData): Promise<Issue> {
    return notImplemented('createIssue');
  }
}
