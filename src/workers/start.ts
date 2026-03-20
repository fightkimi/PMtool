import '@/lib/loadEnv';
import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { AgentRouter } from '@/agents/base/AgentRouter';
import { agentQueue } from '@/agents/base/AgentQueue';
import capacityAgent from '@/agents/capacity/CapacityAgent';
import libuBingAgent from '@/agents/libu_bing/LibuBingAgent';
import libuGongAgent from '@/agents/libu_gong/LibuGongAgent';
import libuHuAgent from '@/agents/libu_hu/LibuHuAgent';
import libuLiAgent from '@/agents/libu_li/LibuLiAgent';
import libuLi2Agent from '@/agents/libu_li2/LibuLi2Agent';
import libuXingAgent from '@/agents/libu_xing/LibuXingAgent';
import menXiaAgent from '@/agents/menxia/MenXiaAgent';
import postMortemAgent from '@/agents/postmortem/PostMortemAgent';
import shangShuAgent from '@/agents/shangshu/ShangShuAgent';
import zhongShuAgent from '@/agents/zhongshu/ZhongShuAgent';
import zhongshuiAgent from '@/agents/zhongshui/ZhongshuiAgent';
import { registry } from '@/adapters/registry';
import { WeComBotAdapter } from '@/adapters/wecom/WeComBotAdapter';
import { createWeComMessageHandler } from '@/app/api/webhooks/wecom/route';
import { db } from '@/lib/db';
import { projects, workspaces } from '@/lib/schema';

async function enqueueCapacitySnapshots() {
  const rows = await db.select().from(workspaces);
  await Promise.all(
    rows.map((workspace) =>
      agentQueue.enqueue({
        id: randomUUID(),
        from: 'zhongshui',
        to: 'capacity',
        type: 'request',
        payload: { workspace_id: workspace.id },
        context: {
          workspace_id: workspace.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        priority: 2,
        created_at: new Date().toISOString()
      })
    )
  );
}

async function enqueueDailyScans() {
  const rows = await db.select().from(projects).where(eq(projects.status, 'active'));
  await Promise.all(
    rows.map((project) =>
      agentQueue.enqueue({
        id: randomUUID(),
        from: 'zhongshui',
        to: 'libu_bing',
        type: 'request',
        payload: { project_id: project.id, type: 'daily_scan' },
        context: {
          workspace_id: project.workspaceId,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        priority: 1,
        created_at: new Date().toISOString()
      })
    )
  );
}

async function enqueueWeeklyReports() {
  const rows = await db.select().from(projects).where(eq(projects.status, 'active'));
  await Promise.all(
    rows.map((project) =>
      agentQueue.enqueue({
        id: randomUUID(),
        from: 'zhongshui',
        to: 'libu_li2',
        type: 'request',
        payload: { project_id: project.id, type: 'weekly_report' },
        context: {
          workspace_id: project.workspaceId,
          project_id: project.id,
          job_id: randomUUID(),
          trace_ids: []
        },
        priority: 2,
        created_at: new Date().toISOString()
      })
    )
  );
}

export async function start() {
  // 从 DB 加载 workspace 配置（API Key、默认模型等）
  await registry.ensureDbConfig();

  const router = new AgentRouter();
  [
    zhongshuiAgent,
    zhongShuAgent,
    menXiaAgent,
    shangShuAgent,
    libuLiAgent,
    libuHuAgent,
    libuLi2Agent,
    libuBingAgent,
    libuXingAgent,
    libuGongAgent,
    capacityAgent,
    postMortemAgent
  ].forEach((agent) => router.register(agent));

  const worker = agentQueue.createWorker(router);
  const messageHandler = createWeComMessageHandler();
  const imAdapter = registry.getIM();
  const botAdapter =
    (process.env.WECOM_MODE ?? 'bot') === 'bot' && imAdapter instanceof WeComBotAdapter ? imAdapter : null;

  if (botAdapter) {
    botAdapter.onMessage(async (message) => {
      await messageHandler(message);
    });
    await botAdapter.start();
  }

  cron.schedule('0 8 * * *', () => {
    void enqueueCapacitySnapshots();
  });

  cron.schedule('0 9 * * *', () => {
    void enqueueDailyScans();
  });

  cron.schedule('30 8 * * 1', () => {
    void enqueueWeeklyReports();
  });

  worker.on('error', (error) => {
    console.error('Worker error:', error);
  });

  process.on('SIGTERM', async () => {
    await botAdapter?.stop();
    await worker.close();
    process.exit(0);
  });

  console.info('GW-PM worker started');
  return worker;
}

void start();
