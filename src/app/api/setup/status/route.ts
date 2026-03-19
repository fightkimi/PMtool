import { createSetupStatusHandlers } from '@/app/api/setup/_status';

const handlers = createSetupStatusHandlers();

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
