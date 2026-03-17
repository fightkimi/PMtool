/* v8 ignore file */
import type { AgentType } from '@/lib/schema';

export interface IMAdapter {
  sendMessage(groupId: string, text: string): Promise<void>;
  sendMarkdown(groupId: string, markdown: string): Promise<void>;
  sendCard(groupId: string, card: IMCard): Promise<void>;
  sendDM(userId: string, content: IMMessage): Promise<void>;
  parseIncoming(payload: unknown): Promise<IncomingMessage | null>;
  getGroupMembers(groupId: string): Promise<IMUser[]>;
}

export interface DocAdapter {
  readTable(tableId: string, filter?: DocFilter): Promise<DocRecord[]>;
  createRecord(tableId: string, fields: DocRecord): Promise<string>;
  updateRecord(tableId: string, recordId: string, fields: Partial<DocRecord>): Promise<void>;
  batchUpdate(tableId: string, updates: Array<{ id: string; fields: Partial<DocRecord> }>): Promise<void>;
  findRecord(tableId: string, field: string, value: string): Promise<DocRecord | null>;
  createTable(rootId: string, name: string, fields: DocField[]): Promise<string>;
}

export interface CodeAdapter {
  getRecentCommits(repo: string, limit: number): Promise<Commit[]>;
  getIssues(repo: string, filter: IssueFilter): Promise<Issue[]>;
  updateIssue(repo: string, number: number, data: Partial<Issue>): Promise<void>;
  getPRStatus(repo: string, number: number): Promise<PRStatus>;
  addIssueComment(repo: string, number: number, body: string): Promise<void>;
  createIssue(repo: string, data: CreateIssueData): Promise<Issue>;
}

export interface AIAdapter {
  chat(messages: AIMessage[], options: AIOptions): Promise<AIResponse>;
  stream(messages: AIMessage[], options: AIOptions): AsyncGenerator<string>;
}

export interface IMCard {
  title: string;
  content: string;
  buttons?: Array<{ text: string; action: string }>;
}

export type IMMessage = { type: 'text'; text: string } | { type: 'card'; card: IMCard };

export interface IncomingMessage {
  type: 'text' | 'button_click' | 'enter_session';
  userId: string;
  groupId: string;
  text?: string;
  buttonAction?: string;
  rawPayload: unknown;
}

export interface IMUser {
  userId: string;
  name: string;
  email?: string;
}

export type DocRecord = Record<string, string | number | boolean | null>;

export interface DocFilter {
  field: string;
  value: string;
}

export interface DocField {
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'member';
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIOptions {
  model?: 'claude' | 'deepseek';
  temperature?: number;
  maxTokens?: number;
  onUsage?: (u: AIUsage) => void;
}

export interface AIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Commit {
  hash: string;
  message: string;
  author?: string;
  timestamp?: Date;
  filesChanged?: number;
  sha?: string;
  committedAt?: string;
}

export interface IssueFilter {
  state?: 'open' | 'closed' | 'all';
  assignee?: string;
  labels?: string[];
  since?: Date;
}

export interface Issue {
  number: number;
  title: string;
  body?: string;
  state?: 'open' | 'closed';
  assignee?: string | null;
  labels?: string[];
  created_at?: Date;
  updated_at?: Date;
}

export interface PRStatus {
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean | null;
  reviews: string[];
  checks: string[];
  head_sha: string;
}

export interface CreateIssueData {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface WeComAdapterConfig {
  corpId?: string;
  agentId?: string;
  agentSecret?: string;
  botToken?: string;
  botAesKey?: string;
  baseUrl?: string;
  groupWebhookMap?: Record<string, string>;
  fetcher?: typeof fetch;
}

export interface TencentDocAdapterConfig {
  appId?: string;
  appSecret?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export interface AnthropicMessageClient {
  messages: {
    create: (...args: any[]) => Promise<any>;
  };
}

export interface AIAdapterConfig {
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  anthropicModel?: string;
  deepseekBaseUrl?: string;
  fetcher?: typeof fetch;
  anthropicClient?: AnthropicMessageClient;
}

export interface CodeAdapterConfig {
  provider?: 'github';
  token?: string;
}

export interface AdapterConfig {
  wecom?: WeComAdapterConfig;
  tencentdoc?: TencentDocAdapterConfig;
  ai?: AIAdapterConfig;
  code?: CodeAdapterConfig;
}

export type SupportedAIModel = 'claude' | 'deepseek';

export type ModelSelector = (agentType: AgentType) => SupportedAIModel;
