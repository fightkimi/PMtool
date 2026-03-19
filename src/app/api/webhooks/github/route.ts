import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { agentQueue } from '@/agents/base/AgentQueue';
import type { AgentMessage } from '@/agents/base/types';
import { registry } from '@/adapters/registry';
import { db } from '@/lib/db';
import { syncTaskToTable } from '@/lib/sync/tableSync';
import { projects, tasks, type InsertTask, type SelectProject, type SelectTask } from '@/lib/schema';

type GitHubWebhookDeps = {
  secret?: string;
  enqueue?: (message: AgentMessage) => Promise<string>;
  getProjectByRepo?: (repo: string) => Promise<SelectProject | null>;
  getTaskByIssueNumber?: (issueNumber: number) => Promise<SelectTask | null>;
  getProjectById?: (projectId: string) => Promise<SelectProject | null>;
  updateTask?: (id: string, data: Partial<InsertTask>) => Promise<void>;
  syncTaskToTable?: (task: SelectTask, project: SelectProject) => Promise<void>;
  now?: () => Date;
};

type GitHubPullRequestPayload = {
  action?: string;
  pull_request?: { merged?: boolean; body?: string | null };
  repository?: { full_name?: string };
  repo?: { full_name?: string };
  commits?: Array<{ message?: string }>;
};

type GitHubIssuePayload = {
  action?: string;
  issue?: { number?: number };
};

function extractIssueNumbers(texts: Array<string | null | undefined>): number[] {
  const numbers = new Set<number>();
  const regex = /(?:close[sd]?|fix(?:e[sd])?)?\s*#(\d+)/gi;

  for (const text of texts) {
    if (!text) {
      continue;
    }

    for (const match of text.matchAll(regex)) {
      numbers.add(Number(match[1]));
    }
  }

  return [...numbers];
}

function verifySignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function defaultGetProjectByRepo(repo: string) {
  const rows = await db.select().from(projects).where(eq(projects.githubRepo, repo));
  return rows[0] ?? null;
}

async function defaultGetTaskByIssueNumber(issueNumber: number) {
  const rows = await db.select().from(tasks).where(eq(tasks.githubIssueNumber, issueNumber));
  return rows[0] ?? null;
}

async function defaultUpdateTask(id: string, data: Partial<InsertTask>) {
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

async function defaultGetProjectById(projectId: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId));
  return rows[0] ?? null;
}

export function createGitHubWebhookHandlers(deps: GitHubWebhookDeps = {}) {
  const secret = deps.secret ?? process.env.GITHUB_WEBHOOK_SECRET ?? '';
  const enqueue = deps.enqueue ?? ((message: AgentMessage) => agentQueue.enqueue(message));
  const getProjectByRepo = deps.getProjectByRepo ?? defaultGetProjectByRepo;
  const getTaskByIssueNumber = deps.getTaskByIssueNumber ?? defaultGetTaskByIssueNumber;
  const getProjectById = deps.getProjectById ?? defaultGetProjectById;
  const updateTask = deps.updateTask ?? defaultUpdateTask;
  const syncTaskToTableFn =
    deps.syncTaskToTable ?? ((task: SelectTask, project: SelectProject) => syncTaskToTable(task, project, registry.getDoc()));
  const now = deps.now ?? (() => new Date());

  return {
    async POST(request: Request) {
      const rawBody = await request.text();
      const signature = request.headers.get('X-Hub-Signature-256');

      if (!secret || !verifySignature(secret, rawBody, signature)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const event = request.headers.get('X-Github-Event');
      const payload = JSON.parse(rawBody) as GitHubPullRequestPayload & GitHubIssuePayload;

      if (event === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged) {
        const repo = payload.repository?.full_name ?? payload.repo?.full_name ?? '';
        const project = repo ? await getProjectByRepo(repo) : null;
        if (project) {
          const issueNumbers = extractIssueNumbers([
            payload.pull_request.body,
            ...(payload.commits ?? []).map((commit) => commit.message)
          ]);

          if (issueNumbers.length > 0) {
            await enqueue({
              id: randomUUID(),
              from: 'zhongshui',
              to: 'libu_gong',
              type: 'request',
              payload: {
                issue_numbers: issueNumbers,
                repo,
                project_id: project.id
              },
              context: {
                workspace_id: project.workspaceId,
                project_id: project.id,
                job_id: randomUUID(),
                trace_ids: []
              },
              priority: 2,
              created_at: now().toISOString()
            });
          }
        }
      }

      if (event === 'issues' && payload.action === 'closed' && payload.issue?.number) {
        const task = await getTaskByIssueNumber(payload.issue.number);
        if (task) {
          const completedAt = now();
          const updatedTask = { ...task, status: 'done' as const, completedAt };
          await updateTask(task.id, { status: 'done', completedAt });
          const project = await getProjectById(task.projectId);
          if (project) {
            await syncTaskToTableFn(updatedTask, project);
          }
          await enqueue({
            id: randomUUID(),
            from: 'zhongshui',
            to: 'libu_li2',
            type: 'progress_update',
            payload: {
              project_id: task.projectId,
              task_id: task.id,
              old_status: task.status,
              new_status: 'done'
            },
            context: {
              workspace_id: '',
              project_id: task.projectId,
              job_id: randomUUID(),
              trace_ids: []
            },
            priority: 2,
            created_at: completedAt.toISOString()
          });
        }
      }

      return Response.json({ ok: true }, { status: 200 });
    }
  };
}

const handlers = createGitHubWebhookHandlers();

export const POST = handlers.POST;
