import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, type InsertTask, type SelectTask, type TaskStatus } from '@/lib/schema';

export async function getTasksByProject(projectId: string): Promise<SelectTask[]> {
  return db.select().from(tasks).where(eq(tasks.projectId, projectId));
}

export async function getTaskById(id: string): Promise<SelectTask | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  return rows[0] ?? null;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  await db.update(tasks).set({ status }).where(eq(tasks.id, id));
}

export async function batchInsertTasks(taskList: InsertTask[]): Promise<SelectTask[]> {
  return db.insert(tasks).values(taskList).returning();
}
