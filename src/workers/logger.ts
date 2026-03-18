type BaseLog = {
  type: string;
  ts: string;
};

type IntentLog = BaseLog & {
  type: 'INTENT';
  intent: string;
  params: Record<string, unknown>;
};

type AgentStartLog = BaseLog & {
  type: 'AGENT_START';
  from: string;
  to: string;
  payload: unknown;
};

type AgentEndLog = BaseLog & {
  type: 'AGENT_END';
  agentType: string;
  status: 'success' | 'failed';
  result?: unknown;
  error?: string;
};

type AiCallLog = BaseLog & {
  type: 'AI_CALL';
  agentType: string;
  model: string;
  promptPreview: string;
  tokensIn: number;
  tokensOut: number;
  mocked: boolean;
};

type DbWriteLog = BaseLog & {
  type: 'DB_WRITE';
  table: string;
  operation: 'insert' | 'update' | 'upsert';
  recordCount: number;
  preview?: unknown;
};

type WeComLog = BaseLog & {
  type: 'WECOM_OUT';
  groupId: string;
  messageType: 'markdown' | 'card' | 'dm';
  preview: string;
};

type ErrorLog = BaseLog & {
  type: 'ERROR';
  agentType: string;
  stage: string;
  error: string;
};

export type StructuredLogEntry =
  | IntentLog
  | AgentStartLog
  | AgentEndLog
  | AiCallLog
  | DbWriteLog
  | WeComLog
  | ErrorLog
  | (BaseLog & Record<string, unknown>);

function emit(entry: StructuredLogEntry) {
  console.log(JSON.stringify(entry));
}

export const agentLogger = {
  intent: (intent: string, params: Record<string, unknown>) =>
    emit({ type: 'INTENT', intent, params, ts: new Date().toISOString() }),

  agentStart: (from: string, to: string, payload: unknown) =>
    emit({ type: 'AGENT_START', from, to, payload, ts: new Date().toISOString() }),

  agentEnd: (agentType: string, status: 'success' | 'failed', result?: unknown, error?: string) =>
    emit({ type: 'AGENT_END', agentType, status, result, error, ts: new Date().toISOString() }),

  aiCall: (
    agentType: string,
    model: string,
    promptPreview: string,
    tokensIn: number,
    tokensOut: number,
    mocked = false
  ) =>
    emit({
      type: 'AI_CALL',
      agentType,
      model,
      promptPreview: promptPreview.slice(0, 200),
      tokensIn,
      tokensOut,
      mocked,
      ts: new Date().toISOString()
    }),

  dbWrite: (table: string, operation: 'insert' | 'update' | 'upsert', recordCount: number, preview?: unknown) =>
    emit({ type: 'DB_WRITE', table, operation, recordCount, preview, ts: new Date().toISOString() }),

  wecom: (groupId: string, messageType: 'markdown' | 'card' | 'dm', preview: string) =>
    emit({
      type: 'WECOM_OUT',
      groupId,
      messageType,
      preview: preview.slice(0, 300),
      ts: new Date().toISOString()
    }),

  error: (agentType: string, stage: string, error: unknown) =>
    emit({ type: 'ERROR', agentType, stage, error: String(error), ts: new Date().toISOString() })
};
