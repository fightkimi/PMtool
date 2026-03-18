#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { eq, desc } from 'drizzle-orm';
import { resolve } from 'node:path';
import { closeDbConnection, db } from '@/lib/db';
import { agentJobs, type SelectAgentJob } from '@/lib/schema';

loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });

type CliArgs = {
  limit?: number;
  jobId?: string;
};

const COLORS = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  cyan: '\u001B[36m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  red: '\u001B[31m',
  magenta: '\u001B[35m',
  blue: '\u001B[34m'
} as const;

function printUsage() {
  console.log('用法：');
  console.log('  npx tsx scripts/debug/showJobs.ts --limit 20');
  console.log('  npx tsx scripts/debug/showJobs.ts --job-id [uuid]');
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const parsed: CliArgs = {};

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--help' || current === '-h') {
      printUsage();
      process.exit(0);
    }

    if (current === '--limit') {
      const rawValue = args.shift();
      const value = Number(rawValue);
      if (!rawValue || Number.isNaN(value) || value <= 0) {
        throw new Error('--limit 必须是大于 0 的数字');
      }
      parsed.limit = value;
      continue;
    }

    if (current === '--job-id') {
      const value = args.shift();
      if (!value) {
        throw new Error('--job-id 不能为空');
      }
      parsed.jobId = value;
      continue;
    }
  }

  if (!parsed.jobId && !parsed.limit) {
    parsed.limit = 20;
  }

  if (parsed.jobId && parsed.limit) {
    throw new Error('--job-id 与 --limit 只能二选一');
  }

  return parsed;
}

function colorize(text: string, color: keyof typeof COLORS): string {
  if (!process.stdout.isTTY) {
    return text;
  }

  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatDate(value: Date | null): string {
  if (!value) {
    return '-';
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatDuration(job: SelectAgentJob): string {
  if (!job.startedAt || !job.finishedAt) {
    return '-';
  }

  const diffMs = job.finishedAt.getTime() - job.startedAt.getTime();
  if (diffMs < 1000) {
    return `${diffMs}ms`;
  }

  const seconds = diffMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainSeconds}s`;
}

function formatTokens(job: SelectAgentJob): string {
  return `${job.tokensInput}/${job.tokensOutput}`;
}

function formatCost(job: SelectAgentJob): string {
  const cost = Number(job.costUsd ?? '0');
  return `$${cost.toFixed(6)}`;
}

function formatStatus(status: SelectAgentJob['status']): string {
  if (status === 'success') {
    return colorize(status, 'green');
  }

  if (status === 'failed' || status === 'vetoed') {
    return colorize(status, 'red');
  }

  if (status === 'running') {
    return colorize(status, 'yellow');
  }

  return colorize(status, 'cyan');
}

function pad(value: string, length: number): string {
  return value.padEnd(length, ' ');
}

function printList(jobs: SelectAgentJob[]) {
  if (jobs.length === 0) {
    console.log('没有查到 agent_jobs 记录。');
    return;
  }

  const headers = ['时间', 'Agent', '状态', '耗时', 'Token', '成本'];
  const rows = jobs.map((job) => [
    formatDate(job.createdAt),
    job.agentType,
    job.status,
    formatDuration(job),
    formatTokens(job),
    formatCost(job)
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );

  console.log(headers.map((header, index) => pad(header, widths[index])).join('  '));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));

  for (const row of rows) {
    const display = [
      pad(row[0], widths[0]),
      pad(row[1], widths[1]),
      pad(formatStatus(row[2] as SelectAgentJob['status']), widths[2] + (process.stdout.isTTY ? 9 : 0)),
      pad(row[3], widths[3]),
      pad(row[4], widths[4]),
      pad(row[5], widths[5])
    ];
    console.log(display.join('  '));
  }
}

function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (!process.stdout.isTTY) {
    return json;
  }

  return json.replace(
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, stringToken: string, colon: string | undefined, keyword: string | undefined) => {
      if (stringToken) {
        if (colon) {
          return `${COLORS.cyan}${stringToken}${COLORS.reset}${colon}`;
        }

        return `${COLORS.green}${stringToken}${COLORS.reset}`;
      }

      if (keyword) {
        if (keyword === 'null') {
          return `${COLORS.dim}${keyword}${COLORS.reset}`;
        }

        return `${COLORS.magenta}${keyword}${COLORS.reset}`;
      }

      return `${COLORS.yellow}${match}${COLORS.reset}`;
    }
  );
}

function printDetail(job: SelectAgentJob) {
  console.log(`${colorize('ID', 'blue')}: ${job.id}`);
  console.log(`${colorize('时间', 'blue')}: ${formatDate(job.createdAt)}`);
  console.log(`${colorize('Agent', 'blue')}: ${job.agentType}`);
  console.log(`${colorize('状态', 'blue')}: ${formatStatus(job.status)}`);
  console.log(`${colorize('耗时', 'blue')}: ${formatDuration(job)}`);
  console.log(`${colorize('Token', 'blue')}: ${formatTokens(job)}`);
  console.log(`${colorize('成本', 'blue')}: ${formatCost(job)}`);

  if (job.modelUsed) {
    console.log(`${colorize('模型', 'blue')}: ${job.modelUsed}`);
  }

  if (job.errorMessage) {
    console.log(`${colorize('错误', 'blue')}: ${job.errorMessage}`);
  }

  console.log('');
  console.log(colorize('[INPUT]', 'magenta'));
  console.log(highlightJson(job.input));
  console.log('');
  console.log(colorize('[OUTPUT]', 'magenta'));
  console.log(highlightJson(job.output ?? null));
}

function maskDatabaseUrl(url?: string): string {
  if (!url) {
    return '(未设置，当前会回退到 src/lib/db.ts 里的默认值)';
  }

  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

function collectErrorTexts(error: unknown): string[] {
  const texts: string[] = [];
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof Error) {
      texts.push(current.message);
      const maybeCause = current as Error & { cause?: unknown };
      if (maybeCause.cause) {
        queue.push(maybeCause.cause);
      }
      continue;
    }

    if (typeof current === 'object') {
      const record = current as {
        message?: unknown;
        cause?: unknown;
        code?: unknown;
        errors?: unknown;
      };
      if (typeof record.message === 'string') {
        texts.push(record.message);
      }
      if (record.cause) {
        queue.push(record.cause);
      }
      if (Array.isArray(record.errors)) {
        queue.push(...record.errors);
      }
      if (typeof record.code === 'string') {
        texts.push(record.code);
      }
      continue;
    }

    if (typeof current === 'string') {
      texts.push(current);
    }
  }

  return texts;
}

function printFriendlyError(error: unknown) {
  const joined = collectErrorTexts(error).join('\n');
  const databaseUrl = maskDatabaseUrl(process.env.DATABASE_URL);

  console.error(colorize('[ERROR] 无法读取 agent_jobs', 'red'));

  if (/ECONNREFUSED|connect|connection|ENOTFOUND|Failed query/i.test(joined)) {
    console.error('看起来当前数据库没有连通。');
    console.error(`DATABASE_URL: ${databaseUrl}`);
    console.error('');
    console.error('建议检查：');
    console.error('1. PostgreSQL 是否已经启动');
    console.error('2. .env.local 里的 DATABASE_URL 是否正确');
    console.error('3. 测试库是否监听在 localhost:5433（如果你走测试环境）');
    console.error('4. 是否已经执行过 `npm run db:migrate`');
  } else if (/relation .*agent_jobs.* does not exist|does not exist/i.test(joined)) {
    console.error('数据库已连通，但 `agent_jobs` 表不存在。');
    console.error('');
    console.error('建议执行：');
    console.error('1. `npm run db:migrate`');
    console.error('2. 重新运行 `npx tsx scripts/debug/showJobs.ts --limit 20`');
  } else if (/password authentication failed|auth/i.test(joined)) {
    console.error('数据库认证失败，请检查用户名、密码和连接串。');
    console.error(`DATABASE_URL: ${databaseUrl}`);
  } else {
    console.error('原始错误摘要：');
    console.error(joined || String(error));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.jobId) {
      const rows = await db.select().from(agentJobs).where(eq(agentJobs.id, args.jobId));
      const job = rows[0] ?? null;
      if (!job) {
        console.error(`未找到 job: ${args.jobId}`);
        process.exitCode = 1;
        return;
      }

      printDetail(job);
      return;
    }

    const rows = await db.select().from(agentJobs).orderBy(desc(agentJobs.createdAt)).limit(args.limit ?? 20);
    printList(rows);
  } finally {
    await closeDbConnection();
  }
}

void main().catch((error: unknown) => {
  printFriendlyError(error);
  process.exitCode = 1;
});
