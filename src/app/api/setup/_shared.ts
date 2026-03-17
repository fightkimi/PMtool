import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, workspaces } from '@/lib/schema';

const DEFAULT_WORKSPACE_SLUG = 'default';

export async function ensureDefaultWorkspace() {
  const existing = await db.select().from(workspaces).where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG));
  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(workspaces)
    .values({
      name: 'Default Workspace',
      slug: DEFAULT_WORKSPACE_SLUG,
      plan: 'free',
      adapterConfig: {}
    })
    .returning();

  return inserted[0]!;
}

export async function createPmUser(workspaceId: string, pmName: string) {
  const inserted = await db
    .insert(users)
    .values({
      workspaceId,
      name: pmName,
      email: `${randomUUID()}@gw-pm.local`,
      role: 'pm',
      skills: ['pm']
    })
    .returning();

  return inserted[0]!;
}
