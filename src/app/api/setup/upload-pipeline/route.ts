import { db } from '@/lib/db';
import { pipelines, type PipelineBusinessType, type PipelineComplexityTier, type PipelineMilestoneAnchor, type PipelineStageDefinition } from '@/lib/schema';
import { ensureDefaultWorkspace } from '../_shared';

type UploadPipelinePayload = {
  name?: string;
  business_type?: PipelineBusinessType;
  complexity_tier?: PipelineComplexityTier;
  milestone_anchors?: PipelineMilestoneAnchor[];
  total_weeks_default?: number;
  stages?: PipelineStageDefinition[];
  is_system_template?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json()) as UploadPipelinePayload;
  if (!body.name) {
    return Response.json({ error: '模板名称必填' }, { status: 400 });
  }

  const workspace = await ensureDefaultWorkspace();
  const inserted = await db
    .insert(pipelines)
    .values({
      workspaceId: workspace.id,
      name: body.name,
      businessType: body.business_type ?? 'custom',
      complexityTier: body.complexity_tier ?? 'a',
      milestoneAnchors: body.milestone_anchors ?? [],
      totalWeeksDefault: body.total_weeks_default ?? null,
      stages: body.stages ?? [],
      historicalVelocities: {},
      isSystemTemplate: body.is_system_template ?? false
    })
    .returning({ pipeline_id: pipelines.id });

  return Response.json(inserted[0] ?? { pipeline_id: null });
}
