/* v8 ignore file */
export type AgentType =
  | 'zhongshui'
  | 'zhongshu'
  | 'menxia'
  | 'shangshu'
  | 'libu_li'
  | 'libu_hu'
  | 'libu_li2'
  | 'libu_bing'
  | 'libu_xing'
  | 'libu_gong'
  | 'capacity'
  | 'postmortem';

export interface AgentMessage {
  id: string;
  from: AgentType;
  to: AgentType;
  type:
    | 'request'
    | 'response'
    | 'veto'
    | 'escalate'
    | 'change_confirmed'
    | 'change_cancelled'
    | 'progress_update';
  payload: Record<string, unknown>;
  context: {
    workspace_id: string;
    project_id?: string;
    job_id: string;
    trace_ids: string[];
  };
  priority: 1 | 2 | 3;
  created_at: string;
}
