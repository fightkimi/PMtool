import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGitHubWebhookHandlers } from '@/app/api/webhooks/github/route';
import type { SelectProject, SelectTask } from '@/lib/schema';

const secret = 'github-secret';

const projectFixture: SelectProject = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'GW-PM',
  type: 'custom',
  status: 'active',
  pmId: null,
  wecomGroupId: null,
  wecomBotWebhook: null,
  wecomMgmtGroupId: null,
  smartTableRootId: null,
  taskTableWebhook: null,
  pipelineTableWebhook: null,
  capacityTableWebhook: null,
  riskTableWebhook: null,
  changeTableWebhook: null,
  taskTableSchema: {},
  pipelineTableSchema: {},
  capacityTableSchema: {},
  riskTableSchema: {},
  changeTableSchema: {},
  githubRepo: 'fightkimi/PMtool',
  budget: { total: 0, spent: 0, token_budget: 0 },
  startedAt: null,
  dueAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const taskFixture: SelectTask = {
  id: 'task-1',
  projectId: 'p1',
  parentId: null,
  title: 'Issue 123',
  description: null,
  status: 'review',
  priority: 'medium',
  assigneeId: null,
  reviewerId: null,
  department: 'libu_gong',
  estimatedHours: 8,
  actualHours: null,
  earliestStart: null,
  latestFinish: null,
  floatDays: null,
  githubIssueNumber: 123,
  acceptanceCriteria: [],
  tableRecordId: null,
  dueAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function signedRequest(event: string, payload: Record<string, unknown>, overrideSignature?: string) {
  const rawBody = JSON.stringify(payload);
  const signature =
    overrideSignature ??
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: {
      'X-Github-Event': event,
      'X-Hub-Signature-256': signature
    },
    body: rawBody
  });
}

describe('github webhook', () => {
  it("enqueues pr_merged payload when PR body contains 'closes #123'", async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const handlers = createGitHubWebhookHandlers({
      secret,
      enqueue,
      getProjectByRepo: vi.fn().mockResolvedValue(projectFixture)
    });

    await handlers.POST(
      signedRequest('pull_request', {
        action: 'closed',
        pull_request: {
          merged: true,
          body: 'This PR closes #123'
        },
        repo: {
          full_name: 'fightkimi/PMtool'
        }
      })
    );

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'libu_gong',
        payload: expect.objectContaining({
          issue_numbers: [123]
        })
      })
    );
  });

  it('updates task and enqueues progress_update when issue is closed', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const getProjectById = vi.fn().mockResolvedValue(projectFixture);
    const syncTaskToTable = vi.fn().mockResolvedValue(undefined);
    const handlers = createGitHubWebhookHandlers({
      secret,
      enqueue,
      getTaskByIssueNumber: vi.fn().mockResolvedValue(taskFixture),
      getProjectById,
      updateTask,
      syncTaskToTable
    });

    await handlers.POST(
      signedRequest('issues', {
        action: 'closed',
        issue: {
          number: 123
        }
      })
    );

    expect(updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'done'
      })
    );
    expect(getProjectById).toHaveBeenCalledWith('p1');
    expect(syncTaskToTable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: 'done'
      }),
      projectFixture
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'libu_li2',
        type: 'progress_update'
      })
    );
  });

  it('returns 401 for invalid signature', async () => {
    const handlers = createGitHubWebhookHandlers({ secret });

    const response = await handlers.POST(
      signedRequest(
        'issues',
        {
          action: 'closed',
          issue: { number: 123 }
        },
        'sha256=invalid'
      )
    );

    expect(response.status).toBe(401);
  });
});
