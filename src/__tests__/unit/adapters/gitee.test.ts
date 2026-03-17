import { describe, expect, it } from 'vitest';
import { GiteeAdapter } from '@/adapters/github/GiteeAdapter';

describe('GiteeAdapter', () => {
  const adapter = new GiteeAdapter();

  it('throws a clear not implemented error for every method', async () => {
    await expect(adapter.getRecentCommits('fightkimi/PMtool', 3)).rejects.toThrow(
      'GiteeAdapter: getRecentCommits not yet implemented'
    );
    await expect(adapter.getIssues('fightkimi/PMtool', { state: 'open' })).rejects.toThrow(
      'GiteeAdapter: getIssues not yet implemented'
    );
    await expect(adapter.updateIssue('fightkimi/PMtool', 1, {})).rejects.toThrow(
      'GiteeAdapter: updateIssue not yet implemented'
    );
    await expect(adapter.getPRStatus('fightkimi/PMtool', 2)).rejects.toThrow(
      'GiteeAdapter: getPRStatus not yet implemented'
    );
    await expect(adapter.addIssueComment('fightkimi/PMtool', 3, 'hello')).rejects.toThrow(
      'GiteeAdapter: addIssueComment not yet implemented'
    );
    await expect(adapter.createIssue('fightkimi/PMtool', { title: 't', body: 'b' })).rejects.toThrow(
      'GiteeAdapter: createIssue not yet implemented'
    );
  });
});
