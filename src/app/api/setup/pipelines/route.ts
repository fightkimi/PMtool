import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pipelines } from '@/lib/schema';

export async function GET() {
  const rows = await db.select().from(pipelines).where(eq(pipelines.isSystemTemplate, true));
  return Response.json(
    rows.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      business_type: pipeline.businessType,
      complexity_tier: pipeline.complexityTier,
      description: `${pipeline.businessType ?? 'custom'} · ${pipeline.stages.length} 个阶段`
    }))
  );
}
