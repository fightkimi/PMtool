import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, type ProjectStatus, type SelectProject } from '@/lib/schema';

export async function getProjectById(id: string): Promise<SelectProject | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  return rows[0] ?? null;
}

export async function getActiveProjects(workspaceId: string): Promise<SelectProject[]> {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.status, 'active')));
}

export async function updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  await db.update(projects).set({ status }).where(eq(projects.id, id));
}
