import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentJobs, type AgentType, type InsertAgentJob, type SelectAgentJob } from '@/lib/schema';

export async function createAgentJob(data: InsertAgentJob): Promise<SelectAgentJob> {
  const rows = await db.insert(agentJobs).values(data).returning();
  return rows[0]!;
}

export async function updateAgentJob(id: string, data: Partial<InsertAgentJob>): Promise<void> {
  await db.update(agentJobs).set(data).where(eq(agentJobs.id, id));
}

export async function getJobsByType(agentType: AgentType, limit = 20): Promise<SelectAgentJob[]> {
  return db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.agentType, agentType))
    .orderBy(desc(agentJobs.createdAt))
    .limit(limit);
}
