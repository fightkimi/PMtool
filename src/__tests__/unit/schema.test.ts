import { describe, expectTypeOf, it } from 'vitest';
import type {
  SelectAgentJob,
  SelectCapacitySnapshot,
  SelectChangeRequest,
  SelectPipeline,
  SelectPipelineRun,
  SelectPipelineStageInstance,
  SelectPostMortem,
  SelectProject,
  SelectRisk,
  SelectTask,
  SelectUser,
  SelectWorkspace,
  TaskStatus
} from '@/lib/schema';

describe('schema types', () => {
  it('SelectTask status type is correct', () => {
    expectTypeOf<SelectTask['status']>().toMatchTypeOf<TaskStatus>();
    expectTypeOf<TaskStatus>().toMatchTypeOf<SelectTask['status']>();
  });

  it('all inferred select types include key fields', () => {
    expectTypeOf<SelectWorkspace>().toHaveProperty('id');
    expectTypeOf<SelectWorkspace>().toHaveProperty('plan');

    expectTypeOf<SelectUser>().toHaveProperty('workspaceId');
    expectTypeOf<SelectUser>().toHaveProperty('role');

    expectTypeOf<SelectProject>().toHaveProperty('workspaceId');
    expectTypeOf<SelectProject>().toHaveProperty('status');

    expectTypeOf<SelectTask>().toHaveProperty('projectId');
    expectTypeOf<SelectTask>().toHaveProperty('acceptanceCriteria');

    expectTypeOf<SelectPipeline>().toHaveProperty('stages');
    expectTypeOf<SelectPipeline>().toHaveProperty('workspaceId');

    expectTypeOf<SelectPipelineRun>().toHaveProperty('pipelineId');
    expectTypeOf<SelectPipelineRun>().toHaveProperty('status');

    expectTypeOf<SelectPipelineStageInstance>().toHaveProperty('runId');
    expectTypeOf<SelectPipelineStageInstance>().toHaveProperty('stageKey');

    expectTypeOf<SelectChangeRequest>().toHaveProperty('affectedTaskIds');
    expectTypeOf<SelectChangeRequest>().toHaveProperty('status');

    expectTypeOf<SelectCapacitySnapshot>().toHaveProperty('snapshotDate');
    expectTypeOf<SelectCapacitySnapshot>().toHaveProperty('overloadFlag');

    expectTypeOf<SelectAgentJob>().toHaveProperty('agentType');
    expectTypeOf<SelectAgentJob>().toHaveProperty('status');

    expectTypeOf<SelectRisk>().toHaveProperty('level');
    expectTypeOf<SelectRisk>().toHaveProperty('detectedBy');

    expectTypeOf<SelectPostMortem>().toHaveProperty('projectId');
    expectTypeOf<SelectPostMortem>().toHaveProperty('lessonsLearned');
  });
});
