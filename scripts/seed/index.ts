import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeDbConnection, db } from '@/lib/db';
import {
  pipelines,
  workspaces,
  type InsertPipeline,
  type PipelineMilestoneAnchor,
  type PipelineStageDefinition
} from '@/lib/schema';

type PipelineSeedFile = {
  name: string;
  business_type: InsertPipeline['businessType'];
  complexity_tier: InsertPipeline['complexityTier'];
  total_weeks_default?: number;
  milestone_anchors?: PipelineMilestoneAnchor[];
  stages: Array<
    Omit<PipelineStageDefinition, 'can_parallel'> & {
      can_parallel?: boolean;
    }
  >;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pipelinesDir = path.join(__dirname, 'pipelines');

async function ensureSeedWorkspace() {
  const rows = await db.select().from(workspaces).where(eq(workspaces.slug, 'default'));
  if (rows[0]) {
    return rows[0];
  }

  const inserted = await db
    .insert(workspaces)
    .values({
      name: 'Default Workspace',
      slug: 'default',
      plan: 'free',
      adapterConfig: {}
    })
    .returning();

  return inserted[0]!;
}

async function main() {
  const workspace = await ensureSeedWorkspace();
  const files = (await readdir(pipelinesDir)).filter((file) => file.endsWith('.json'));
  let count = 0;

  for (const file of files) {
    const content = await readFile(path.join(pipelinesDir, file), 'utf8');
    const parsed = JSON.parse(content) as PipelineSeedFile;
    const payload: InsertPipeline = {
      workspaceId: workspace.id,
      name: parsed.name,
      businessType: parsed.business_type ?? 'custom',
      complexityTier: parsed.complexity_tier ?? 'a',
      milestoneAnchors: parsed.milestone_anchors ?? [],
      totalWeeksDefault: parsed.total_weeks_default ?? null,
      stages: parsed.stages.map((stage) => ({
        ...stage,
        can_parallel: stage.can_parallel ?? false
      })),
      historicalVelocities: {},
      isSystemTemplate: true
    };

    const existing = await db.select().from(pipelines).where(eq(pipelines.name, parsed.name));
    if (existing[0]) {
      await db.update(pipelines).set(payload).where(eq(pipelines.id, existing[0].id));
    } else {
      await db.insert(pipelines).values(payload);
    }
    count += 1;
  }

  console.log(`Seeded ${count} pipeline templates`);
}

void main().finally(async () => {
  await closeDbConnection();
});
