'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../lib/requestJson';
import type { WorkspaceAdapterConfig } from '@/types/adapter-config';

type ProjectTableHealth = {
  key: 'task' | 'pipeline' | 'capacity' | 'risk' | 'change';
  label: string;
  state: 'missing' | 'needs_schema' | 'ready' | 'synced';
  webhookConfigured: boolean;
  schemaConfigured: boolean;
  lastSyncedAt: string | null;
  recordCount: number;
};

type SetupProjectSummary = {
  id: string;
  name: string;
  type: 'game_dev' | 'outsource' | 'office_app' | 'custom';
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  groupId: string | null;
  mgmtGroupId: string | null;
  tableRootId: string | null;
  taskTableWebhook: string | null;
  taskTableSchema: Record<string, string>;
  pipelineTableWebhook: string | null;
  pipelineTableSchema: Record<string, string>;
  capacityTableWebhook: string | null;
  capacityTableSchema: Record<string, string>;
  riskTableWebhook: string | null;
  riskTableSchema: Record<string, string>;
  changeTableWebhook: string | null;
  changeTableSchema: Record<string, string>;
  tables: { task: boolean; pipeline: boolean; capacity: boolean; risk: boolean };
  tableHealth: ProjectTableHealth[];
  recentSyncs: Array<{
    key: 'task' | 'pipeline' | 'capacity' | 'risk' | 'change';
    label: string;
    syncedAt: string;
    summary: string;
  }>;
  healthSummary: {
    readyTables: number;
    syncedTables: number;
    attentionTables: number;
  };
  pmSummary: {
    blockedCount: number;
    overdueCount: number;
    dueSoonCount: number;
    openRiskCount: number;
    criticalRiskCount: number;
    milestoneRiskCount: number;
    activeChangeCount: number;
    lastWeeklyReportAt: string | null;
    weeklyReportStatus: 'fresh' | 'stale' | 'missing';
    attentionLevel: 'high' | 'medium' | 'low';
    highlights: string[];
  };
};

type SetupStatusResponse = {
  workspace: { id: string; name: string };
  adapterConfig: WorkspaceAdapterConfig;
  bot: { configured: boolean; botId: string | null; connected: boolean };
  ai: {
    defaultModel: string;
    providers: {
      doubao: boolean;
      minimax: boolean;
      zhipu: boolean;
      deepseek: boolean;
      claude: boolean;
    };
  };
  tencentdoc: { configured: boolean; appIdPreview: string | null };
  projects: SetupProjectSummary[];
};

type OperationResult = {
  success: boolean;
  latencyMs?: number;
  error?: string;
  model?: string;
};

type StreamEvent = {
  status: 'success' | 'warning' | 'error';
  label: string;
  detail: string;
  elapsedMs: number;
  raw?: unknown;
};

type ProjectFormState = {
  id?: string;
  name: string;
  type: 'game_dev' | 'outsource' | 'office_app' | 'custom';
  groupId: string;
  mgmtGroupId: string;
  tableRootId: string;
  taskTableWebhook: string;
  taskTableSchema: string;
  pipelineTableWebhook: string;
  pipelineTableSchema: string;
  capacityTableWebhook: string;
  capacityTableSchema: string;
  riskTableWebhook: string;
  riskTableSchema: string;
  changeTableWebhook: string;
  changeTableSchema: string;
};

type AdapterFormState = {
  botId: string;
  botSecret: string;
  defaultModel: string;
  anthropicApiKey: string;
  zhipuApiKey: string;
  deepseekApiKey: string;
  arkApiKey: string;
  minimaxApiKey: string;
};

type Tab = 'config' | 'projects' | 'test' | 'ops';

const emptyAdapterForm: AdapterFormState = {
  botId: '', botSecret: '', defaultModel: '',
  anthropicApiKey: '', zhipuApiKey: '', deepseekApiKey: '', arkApiKey: '', minimaxApiKey: '',
};

const projectTypes: ProjectFormState['type'][] = ['game_dev', 'outsource', 'office_app', 'custom'];
const projectTypeLabels: Record<ProjectFormState['type'], string> = {
  game_dev: '游戏研发', outsource: '外包项目', office_app: '办公应用', custom: '自定义',
};

const triggerTypes = [
  { key: 'daily_scan', label: '立即触发日报', icon: '📋' },
  { key: 'weekly_report', label: '触发周报', icon: '📊' },
  { key: 'capacity_snapshot', label: '触发产能快照', icon: '⚡' }
] as const;

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'config', label: '全局配置', icon: '⚙️' },
  { key: 'projects', label: '项目管理', icon: '📁' },
  { key: 'test', label: '链路测试', icon: '🔗' },
  { key: 'ops', label: '运维操作', icon: '🛠️' },
];

type TableConfigDef = {
  key: string;
  label: string;
  webhookField: keyof ProjectFormState;
  schemaField: keyof ProjectFormState;
  required: boolean;
  description: string;
  defaultCols: string;
};

const tableConfigs: TableConfigDef[] = [
  { key: 'task', label: '任务表', webhookField: 'taskTableWebhook', schemaField: 'taskTableSchema', required: true, description: 'Agent 拆解的任务写入此表', defaultCols: '任务名、状态、负责人、工种、估算工时、实际工时、截止日期、优先级' },
  { key: 'pipeline', label: '管线排期表', webhookField: 'pipelineTableWebhook', schemaField: 'pipelineTableSchema', required: false, description: 'Pipeline 阶段排期数据', defaultCols: 'Run名、阶段编号、工种、负责人、计划开始、计划结束、浮动天数、状态' },
  { key: 'capacity', label: '产能表', webhookField: 'capacityTableWebhook', schemaField: 'capacityTableSchema', required: false, description: '团队产能快照', defaultCols: '成员、工种、周期、可用工时、已分配、负载率' },
  { key: 'risk', label: '风险表', webhookField: 'riskTableWebhook', schemaField: 'riskTableSchema', required: false, description: '风险扫描结果', defaultCols: '风险描述、等级、发现时间、状态、处理人' },
  { key: 'change', label: '变更表', webhookField: 'changeTableWebhook', schemaField: 'changeTableSchema', required: false, description: '变更请求记录', defaultCols: '变更标题、类型、状态、影响范围' },
];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function createEmptyProjectForm(): ProjectFormState {
  return {
    name: '', type: 'custom', groupId: '', mgmtGroupId: '', tableRootId: '',
    taskTableWebhook: '', taskTableSchema: '', pipelineTableWebhook: '', pipelineTableSchema: '',
    capacityTableWebhook: '', capacityTableSchema: '', riskTableWebhook: '', riskTableSchema: '',
    changeTableWebhook: '', changeTableSchema: '',
  };
}

function stringifySchema(value: Record<string, string> | null | undefined): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
}

function parseSchemaJson(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('字段映射必须是 JSON 对象');
  }
  const obj = parsed as Record<string, unknown>;
  if ('schema' in obj && typeof obj.schema === 'object' && obj.schema !== null && !Array.isArray(obj.schema)) {
    return Object.fromEntries(
      Object.entries(obj.schema as Record<string, unknown>).map(([key, item]) => [key, String(item)])
    );
  }
  return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, String(item)]));
}

function validateProjectTableSchemas(form: ProjectFormState): string | null {
  for (const cfg of tableConfigs) {
    const webhookValue = String(form[cfg.webhookField] ?? '').trim();
    const schemaValue = parseSchemaJson(String(form[cfg.schemaField] ?? ''));
    if (webhookValue && Object.keys(schemaValue).length === 0) {
      return `${cfg.label}已填写 Webhook，还需要补充字段映射。请直接粘贴 Webhook 示例 JSON，系统会自动提取 schema。`;
    }
  }

  return null;
}

function adapterFormFromConfig(ac: WorkspaceAdapterConfig, fallbackModel: string): AdapterFormState {
  return {
    botId: ac.wecom?.botId ?? '', botSecret: ac.wecom?.botSecret ?? '',
    defaultModel: ac.ai?.defaultModel ?? fallbackModel,
    anthropicApiKey: ac.ai?.anthropicApiKey ?? '', zhipuApiKey: ac.ai?.zhipuApiKey ?? '',
    deepseekApiKey: ac.ai?.deepseekApiKey ?? '', arkApiKey: ac.ai?.arkApiKey ?? '',
    minimaxApiKey: ac.ai?.minimaxApiKey ?? '',
  };
}

// ── Toast 组件 ──
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={cn(
      'fixed bottom-6 right-6 z-[60] flex items-center gap-3 rounded-2xl px-5 py-3.5 text-sm font-medium shadow-lg transition-all animate-[slideUp_0.3s_ease-out]',
      type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
    )}>
      <span>{type === 'success' ? '✓' : '✕'}</span>
      <span>{message}</span>
    </div>
  );
}

// ── 密码输入框（带显示/隐藏切换）──
function SecretInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
          onClick={() => setVisible(!visible)}
          tabIndex={-1}
        >
          {visible ? '隐藏' : '显示'}
        </button>
      </div>
    </label>
  );
}

// ── 状态指示器 ──
function StatusDot({ ok, okText, noText }: { ok: boolean; okText: string; noText: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
      ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
    )}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      {ok ? okText : noText}
    </span>
  );
}

function formatDateTimeLabel(value: string | null): string {
  if (!value) {
    return '暂无写入';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '暂无写入';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatRecentSyncTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function getTableHealthTone(state: ProjectTableHealth['state']) {
  if (state === 'synced') {
    return {
      badge: 'bg-emerald-50 text-emerald-700',
      panel: 'border-emerald-200 bg-emerald-50/60',
      label: '已有写入'
    };
  }

  if (state === 'ready') {
    return {
      badge: 'bg-sky-50 text-sky-700',
      panel: 'border-sky-200 bg-sky-50/60',
      label: '已就绪'
    };
  }

  if (state === 'needs_schema') {
    return {
      badge: 'bg-amber-50 text-amber-700',
      panel: 'border-amber-200 bg-amber-50/60',
      label: '待补映射'
    };
  }

  return {
    badge: 'bg-slate-100 text-slate-500',
    panel: 'border-slate-200 bg-slate-50',
    label: '未配置'
  };
}

function getTableHealthHint(item: ProjectTableHealth): string {
  if (item.state === 'synced') {
    return `${formatDateTimeLabel(item.lastSyncedAt)} · ${item.recordCount} 条记录`;
  }

  if (item.state === 'ready') {
    return 'Webhook 和 schema 已齐，等待首次写入';
  }

  if (item.state === 'needs_schema') {
    return '已填 Webhook，还缺字段映射';
  }

  return '尚未配置 Webhook';
}

function getPmAttentionTone(level: SetupProjectSummary['pmSummary']['attentionLevel']) {
  if (level === 'high') {
    return {
      badge: 'bg-rose-50 text-rose-700',
      label: '优先处理'
    };
  }

  if (level === 'medium') {
    return {
      badge: 'bg-amber-50 text-amber-700',
      label: '持续关注'
    };
  }

  return {
    badge: 'bg-emerald-50 text-emerald-700',
    label: '状态稳定'
  };
}

function getWeeklyReportTone(status: SetupProjectSummary['pmSummary']['weeklyReportStatus']) {
  if (status === 'fresh') {
    return {
      badge: 'bg-emerald-50 text-emerald-700',
      label: '本周已更新'
    };
  }

  if (status === 'stale') {
    return {
      badge: 'bg-amber-50 text-amber-700',
      label: '超过 7 天未更新'
    };
  }

  return {
    badge: 'bg-slate-100 text-slate-500',
    label: '暂无周报'
  };
}

function getPmMetricTone(value: number, emphasis: 'high' | 'medium' | 'neutral' = 'neutral') {
  if (value === 0) {
    return 'bg-slate-50 text-slate-500';
  }

  if (emphasis === 'high') {
    return 'bg-rose-50 text-rose-700';
  }

  if (emphasis === 'medium') {
    return 'bg-amber-50 text-amber-700';
  }

  return 'bg-sky-50 text-sky-700';
}

function getProjectAttentionRank(project: SetupProjectSummary) {
  if (project.pmSummary.attentionLevel === 'high') {
    return 0;
  }
  if (project.pmSummary.attentionLevel === 'medium') {
    return 1;
  }
  return 2;
}

export function DashboardClient() {
  const [status, setStatus] = useState<SetupStatusResponse | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('config');
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(createEmptyProjectForm());
  const [savingProject, setSavingProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [testMessage, setTestMessage] = useState('@助手 分析需求：登录流程优化');
  const [testMode, setTestMode] = useState<'smoke' | 'full'>('smoke');
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [runningTest, setRunningTest] = useState(false);
  const [totalElapsedMs, setTotalElapsedMs] = useState<number | null>(null);
  const [opState, setOpState] = useState<Record<string, string>>({});
  const [adapterForm, setAdapterForm] = useState<AdapterFormState>(emptyAdapterForm);
  const [savingAdapter, setSavingAdapter] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
  }

  function updateAdapterField<K extends keyof AdapterFormState>(key: K, value: AdapterFormState[K]) {
    setAdapterForm((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshStatus() {
    setLoading(true);
    setPageError('');
    try {
      const data = await requestJson<SetupStatusResponse>('/api/setup/status');
      setStatus(data);
      setWorkspaceName(data.workspace.name);
      setSelectedProjectId((current) => current || data.projects[0]?.id || '');
      setAdapterForm(adapterFormFromConfig(data.adapterConfig, data.ai.defaultModel));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refreshStatus(); }, []);

  useEffect(() => {
    if (!projectModalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setProjectModalOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [projectModalOpen]);

  useEffect(() => {
    if (projectModalOpen && modalRef.current) modalRef.current.focus();
  }, [projectModalOpen]);

  const selectedProject = useMemo(
    () => status?.projects.find((p) => p.id === selectedProjectId) ?? null,
    [selectedProjectId, status?.projects]
  );

  async function runWorkspacePatch() {
    try {
      await requestJson('/api/setup/status', {
        method: 'PATCH', body: JSON.stringify({ name: workspaceName })
      });
      showToast('企业名称已保存');
      await refreshStatus();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function saveAdapterConfig() {
    setSavingAdapter(true);
    setPageError('');
    try {
      const config: WorkspaceAdapterConfig = {
        wecom: {
          botId: adapterForm.botId.trim() || undefined,
          botSecret: adapterForm.botSecret.trim() || undefined,
        },
        ai: {
          defaultModel: adapterForm.defaultModel.trim() || undefined,
          anthropicApiKey: adapterForm.anthropicApiKey.trim() || undefined,
          zhipuApiKey: adapterForm.zhipuApiKey.trim() || undefined,
          deepseekApiKey: adapterForm.deepseekApiKey.trim() || undefined,
          arkApiKey: adapterForm.arkApiKey.trim() || undefined,
          minimaxApiKey: adapterForm.minimaxApiKey.trim() || undefined,
        }
      };
      await requestJson('/api/setup/status', {
        method: 'PATCH', body: JSON.stringify({ adapterConfig: config })
      });
      showToast('全部配置已保存');
      await refreshStatus();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存配置失败', 'error');
    } finally {
      setSavingAdapter(false);
    }
  }

  async function handleQuickTest(key: 'wecom' | 'ai' | 'tencentdoc') {
    setOpState((c) => ({ ...c, [key]: '测试中...' }));
    try {
      const body = key === 'wecom' && selectedProjectId
        ? JSON.stringify({ projectId: selectedProjectId })
        : key === 'tencentdoc' && selectedProjectId
          ? JSON.stringify({ projectId: selectedProjectId })
          : key === 'ai'
            ? JSON.stringify({})
            : undefined;
      const result = await requestJson<OperationResult>(`/api/setup/test-${key}`, { method: 'POST', body });
      setOpState((c) => ({
        ...c,
        [key]: result.success
          ? `✓ 成功${result.latencyMs ? ` · ${result.latencyMs}ms` : ''}${result.model ? ` · ${result.model}` : ''}`
          : `✕ ${result.error ?? '失败'}`
      }));
    } catch (error) {
      setOpState((c) => ({ ...c, [key]: `✕ ${error instanceof Error ? error.message : '失败'}` }));
    }
  }

  function openCreateModal() {
    setProjectForm(createEmptyProjectForm());
    setProjectModalOpen(true);
  }

  function openEditModal(project: SetupStatusResponse['projects'][number]) {
    setProjectForm({
      id: project.id, name: project.name, type: project.type,
      groupId: project.groupId ?? '', mgmtGroupId: project.mgmtGroupId ?? '',
      tableRootId: project.tableRootId ?? '',
      taskTableWebhook: project.taskTableWebhook ?? '', taskTableSchema: stringifySchema(project.taskTableSchema),
      pipelineTableWebhook: project.pipelineTableWebhook ?? '', pipelineTableSchema: stringifySchema(project.pipelineTableSchema),
      capacityTableWebhook: project.capacityTableWebhook ?? '', capacityTableSchema: stringifySchema(project.capacityTableSchema),
      riskTableWebhook: project.riskTableWebhook ?? '', riskTableSchema: stringifySchema(project.riskTableSchema),
      changeTableWebhook: project.changeTableWebhook ?? '', changeTableSchema: stringifySchema(project.changeTableSchema),
    });
    setProjectModalOpen(true);
  }

  async function saveProject() {
    if (!projectForm.name.trim()) { setPageError('项目名称必填'); return; }
    setSavingProject(true);
    setPageError('');
    try {
      const schemaError = validateProjectTableSchemas(projectForm);
      if (schemaError) {
        throw new Error(schemaError);
      }
      if (projectForm.id) {
        await requestJson(`/api/setup/projects/${projectForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: projectForm.name, type: projectForm.type,
            groupId: projectForm.groupId, mgmtGroupId: projectForm.mgmtGroupId,
            tableRootId: projectForm.tableRootId,
            taskTableWebhook: projectForm.taskTableWebhook, taskTableSchema: parseSchemaJson(projectForm.taskTableSchema),
            pipelineTableWebhook: projectForm.pipelineTableWebhook, pipelineTableSchema: parseSchemaJson(projectForm.pipelineTableSchema),
            capacityTableWebhook: projectForm.capacityTableWebhook, capacityTableSchema: parseSchemaJson(projectForm.capacityTableSchema),
            riskTableWebhook: projectForm.riskTableWebhook, riskTableSchema: parseSchemaJson(projectForm.riskTableSchema),
            changeTableWebhook: projectForm.changeTableWebhook, changeTableSchema: parseSchemaJson(projectForm.changeTableSchema),
          })
        });
      } else {
        await requestJson('/api/setup/projects', {
          method: 'POST',
          body: JSON.stringify({ name: projectForm.name, type: projectForm.type, groupId: projectForm.groupId, tableRootId: projectForm.tableRootId })
        });
      }
      setProjectModalOpen(false);
      showToast(projectForm.id ? '项目配置已保存' : '项目已创建');
      await refreshStatus();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存项目失败', 'error');
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject(projectId: string) {
    setDeleteConfirm(null);
    setOpState((c) => ({ ...c, [`delete:${projectId}`]: '删除中...' }));
    try {
      await requestJson(`/api/setup/projects/${projectId}`, { method: 'DELETE' });
      showToast('项目已归档');
      await refreshStatus();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error');
    }
  }

  async function runProjectMessageTest(projectId: string) {
    setOpState((c) => ({ ...c, [`msg:${projectId}`]: '发送中...' }));
    try {
      const result = await requestJson<OperationResult>('/api/setup/test-wecom', {
        method: 'POST', body: JSON.stringify({ projectId })
      });
      setOpState((c) => ({
        ...c,
        [`msg:${projectId}`]: result.success ? `✓ ${result.latencyMs ?? 0}ms` : `✕ ${result.error ?? '失败'}`
      }));
    } catch (error) {
      setOpState((c) => ({ ...c, [`msg:${projectId}`]: `✕ ${error instanceof Error ? error.message : '失败'}` }));
    }
  }

  async function triggerOperation(type: (typeof triggerTypes)[number]['key']) {
    if (!selectedProjectId && type !== 'capacity_snapshot') { setPageError('请先选择项目'); return; }
    setOpState((c) => ({ ...c, [type]: '执行中...' }));
    try {
      const result = await requestJson<{ success: boolean; error?: string; agentType?: string }>('/api/agents/trigger', {
        method: 'POST', body: JSON.stringify({ type, projectId: selectedProjectId || undefined })
      });
      setOpState((c) => ({
        ...c,
        [type]: result.success ? `✓ ${result.agentType ?? '完成'}` : `✕ ${result.error ?? '失败'}`
      }));
    } catch (error) {
      setOpState((c) => ({ ...c, [type]: `✕ ${error instanceof Error ? error.message : '失败'}` }));
    }
  }

  async function runChainTest() {
    if (!selectedProjectId) { setPageError('请先选择一个项目'); return; }
    setEvents([]); setRawLogs([]); setTotalElapsedMs(null); setRunningTest(true); setPageError('');
    try {
      const response = await fetch('/api/setup/run-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, message: testMessage, mode: testMode })
      });
      if (!response.ok || !response.body) throw new Error('链路测试启动失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
          if (!line) continue;
          setRawLogs((c) => [...c, line]);
          const parsed = JSON.parse(line) as StreamEvent | { done: true; totalMs: number };
          if ('done' in parsed) setTotalElapsedMs(parsed.totalMs);
          else setEvents((c) => [...c, parsed]);
        }
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '链路测试失败');
    } finally {
      setRunningTest(false);
    }
  }

  const renderTableConfig = useCallback((cfg: TableConfigDef) => {
    const webhookValue = projectForm[cfg.webhookField] as string;
    const schemaValue = projectForm[cfg.schemaField] as string;
    return (
      <details key={cfg.key} className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4" open={cfg.required}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          {cfg.label} {webhookValue ? '✓' : ''}
          <span className="ml-2 text-xs font-normal text-slate-400">
            ({cfg.required ? '必填' : '选填'} · {cfg.description})
          </span>
        </summary>
        <div className="mt-3 grid gap-3">
          <input className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            placeholder="Webhook 地址" value={webhookValue}
            onChange={(e) => setProjectForm((p) => ({ ...p, [cfg.webhookField]: e.target.value }))} />
          <details className="rounded-xl border border-slate-100 bg-white px-4 py-3">
            <summary className="cursor-pointer text-xs text-slate-500">
              字段映射（建议直接粘贴 Webhook 示例 JSON，系统自动提取）
            </summary>
            <p className="mt-2 text-xs text-slate-400">
              推荐列名：{cfg.defaultCols}。Webhook 写入仍需要字段 ID，请粘贴 Webhook 示例 JSON，或手动填写：{`{"字段ID":"列名"}`}
            </p>
            <textarea className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              placeholder='可粘贴完整 Webhook 示例 JSON，或 {"f1":"任务名"} 这种 schema 映射' value={schemaValue}
              onChange={(e) => setProjectForm((p) => ({ ...p, [cfg.schemaField]: e.target.value }))} />
          </details>
        </div>
      </details>
    );
  }, [projectForm]);

  // ── 状态概览卡片 ──
  function renderStatusCards() {
    if (!status) return null;
    const items = [
      { label: '企微机器人', ok: status.bot.configured, okText: '已连接', noText: '未配置' },
      { label: 'AI 模型', ok: Object.values(status.ai.providers).some(Boolean), okText: status.ai.defaultModel, noText: '未配置' },
      { label: '腾讯文档', ok: status.tencentdoc.configured, okText: '已配置', noText: '未配置' },
      { label: '项目数', ok: status.projects.length > 0, okText: `${status.projects.length} 个`, noText: '无项目' },
    ];
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-400">{item.label}</p>
            <div className="mt-2">
              <StatusDot ok={item.ok} okText={item.okText} noText={item.noText} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Tab: 全局配置 ──
  function renderConfigTab() {
    if (!status) return null;
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        {/* 左列：企业 + 企微机器人 */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-700">企业信息</h3>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">企业名称</span>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
                <button className="shrink-0 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                  onClick={() => void runWorkspacePatch()}>
                  保存
                </button>
              </div>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">企业微信智能机器人</h3>
              <StatusDot ok={status.bot.configured} okText="已配置" noText="未配置" />
            </div>
            <p className="mt-1 text-xs text-slate-400">修改后需重启 Worker 以重建 WebSocket 连接</p>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">BOT ID</span>
                <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                  placeholder="从企微管理后台获取" value={adapterForm.botId}
                  onChange={(e) => updateAdapterField('botId', e.target.value)} />
              </label>
              <SecretInput label="BOT Secret" value={adapterForm.botSecret}
                onChange={(v) => updateAdapterField('botSecret', v)} placeholder="从企微管理后台获取" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-700">腾讯文档 / 智能表格</h3>
            <div className="mt-3">
              <StatusDot ok={status.tencentdoc.configured} okText="已配置" noText="未配置" />
              {status.tencentdoc.appIdPreview && (
                <span className="ml-2 text-xs text-slate-400">{status.tencentdoc.appIdPreview}</span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">腾讯文档 Webhook 在各项目的编辑配置中单独设置。</p>
          </div>
        </div>

        {/* 右列：AI 模型 */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">AI 模型配置</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(status.ai.providers).map(([key, on]) => (
                  <span key={key} className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                    on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
                  )}>
                    {key}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">默认模型</span>
                <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                  placeholder="claude / glm / deepseek / doubao / minimax" value={adapterForm.defaultModel}
                  onChange={(e) => updateAdapterField('defaultModel', e.target.value)} />
                <p className="mt-1 text-xs text-slate-400">别名：claude / glm / glm-flash / deepseek / doubao / minimax</p>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <SecretInput label="Anthropic API Key" value={adapterForm.anthropicApiKey}
                  onChange={(v) => updateAdapterField('anthropicApiKey', v)} placeholder="sk-ant-..." />
                <SecretInput label="智谱 (Zhipu) API Key" value={adapterForm.zhipuApiKey}
                  onChange={(v) => updateAdapterField('zhipuApiKey', v)} placeholder="zhipu api key" />
                <SecretInput label="DeepSeek API Key" value={adapterForm.deepseekApiKey}
                  onChange={(v) => updateAdapterField('deepseekApiKey', v)} placeholder="sk-..." />
                <SecretInput label="火山方舟 (Doubao) API Key" value={adapterForm.arkApiKey}
                  onChange={(v) => updateAdapterField('arkApiKey', v)} placeholder="ark api key" />
                <SecretInput label="MiniMax API Key" value={adapterForm.minimaxApiKey}
                  onChange={(v) => updateAdapterField('minimaxApiKey', v)} placeholder="minimax api key" />
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-700">保存与测试</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 sm:col-span-2"
                disabled={savingAdapter} onClick={() => void saveAdapterConfig()}>
                {savingAdapter ? '保存中...' : '保存全部配置'}
              </button>
              <button className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => void handleQuickTest('wecom')}>
                测试 BOT 连接
              </button>
              <button className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => void handleQuickTest('ai')}>
                测试 AI 调用
              </button>
              <button className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:col-span-2"
                onClick={() => void handleQuickTest('tencentdoc')}>
                测试腾讯文档 Webhook
              </button>
            </div>
            {(['wecom', 'ai', 'tencentdoc'] as const).map((key) =>
              opState[key] ? (
                <p key={key} className={cn('mt-3 text-sm', opState[key].startsWith('✓') ? 'text-emerald-600' : opState[key].startsWith('✕') ? 'text-rose-600' : 'text-slate-500')}>
                  {opState[key]}
                </p>
              ) : null
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Tab: 项目管理 ──
  function renderProjectsTab() {
    if (!status) return null;
    const projectsForDisplay = [...status.projects].sort((left, right) => {
      const attentionDiff = getProjectAttentionRank(left) - getProjectAttentionRank(right);
      if (attentionDiff !== 0) {
        return attentionDiff;
      }

      const issueDiff =
        (right.pmSummary.blockedCount + right.pmSummary.criticalRiskCount + right.pmSummary.overdueCount) -
        (left.pmSummary.blockedCount + left.pmSummary.criticalRiskCount + left.pmSummary.overdueCount);
      if (issueDiff !== 0) {
        return issueDiff;
      }

      return left.name.localeCompare(right.name, 'zh-CN');
    });
    const syncedProjects = status.projects.filter((project) => project.healthSummary.syncedTables > 0).length;
    const readyProjects = status.projects.filter(
      (project) => project.healthSummary.readyTables > 0 && project.healthSummary.attentionTables === 0
    ).length;
    const attentionProjects = status.projects.filter((project) => project.healthSummary.attentionTables > 0).length;
    const highAttentionProjects = status.projects.filter((project) => project.pmSummary.attentionLevel === 'high').length;
    const blockedItems = status.projects.reduce((total, project) => total + project.pmSummary.blockedCount, 0);
    const openRisks = status.projects.reduce((total, project) => total + project.pmSummary.openRiskCount, 0);

    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700">{status.projects.length} 个项目</p>
            <p className="mt-1 text-xs text-slate-400">项目卡片会同时展示配表健康度、最近同步证据和 PM 当前关注信号。</p>
          </div>
          <button className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            onClick={openCreateModal}>
            + 新增项目
          </button>
        </div>
        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-400">配置已就绪</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{readyProjects}</p>
            <p className="mt-1 text-xs text-slate-500">Webhook 与 schema 都已补齐</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-400">已有写入证据</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{syncedProjects}</p>
            <p className="mt-1 text-xs text-slate-500">至少一张表已经写入过记录</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-xs font-medium text-slate-400">需要处理</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{attentionProjects}</p>
            <p className="mt-1 text-xs text-slate-500">已配 Webhook 但还缺字段映射</p>
          </div>
        </div>
        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-3.5">
            <p className="text-xs font-medium text-rose-500">高关注项目</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{highAttentionProjects}</p>
            <p className="mt-1 text-xs text-slate-500">存在阻塞、逾期、关键风险或里程碑偏差</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5">
            <p className="text-xs font-medium text-amber-600">阻塞事项</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{blockedItems}</p>
            <p className="mt-1 text-xs text-slate-500">任务阻塞和排期阻塞合并统计</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3.5">
            <p className="text-xs font-medium text-sky-600">开放风险</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{openRisks}</p>
            <p className="mt-1 text-xs text-slate-500">按项目风险表中的未解决记录汇总</p>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {projectsForDisplay.map((project) => {
            const attentionTone = getPmAttentionTone(project.pmSummary.attentionLevel);
            const weeklyReportTone = getWeeklyReportTone(project.pmSummary.weeklyReportStatus);
            return (
            <article key={project.id} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{project.name}</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {projectTypeLabels[project.type]} · 群 ID：{project.groupId ? `${project.groupId.slice(0, 12)}...` : '未配置'}
                  </p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-semibold',
                  project.status === 'active' ? 'bg-emerald-50 text-emerald-700'
                    : project.status === 'planning' ? 'bg-amber-50 text-amber-700'
                    : project.status === 'completed' ? 'bg-slate-100 text-slate-600'
                    : 'bg-rose-50 text-rose-600'
                )}>
                  {project.status}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusDot ok={Boolean(project.groupId)} okText="群聊已绑定" noText="待绑群聊" />
                <StatusDot
                  ok={project.healthSummary.attentionTables === 0 && project.healthSummary.readyTables > 0}
                  okText={`${project.healthSummary.readyTables} 张表就绪`}
                  noText={project.healthSummary.attentionTables > 0 ? `${project.healthSummary.attentionTables} 项待处理` : '尚未配表'}
                />
                <StatusDot
                  ok={project.healthSummary.syncedTables > 0}
                  okText={`${project.healthSummary.syncedTables} 张表已写入`}
                  noText="暂无写入"
                />
              </div>

              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">PM 看板</p>
                    <p className="mt-1 text-xs text-slate-400">先看项目状态，再决定要不要下钻到表格配置。</p>
                  </div>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-medium', attentionTone.badge)}>
                    {attentionTone.label}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className={cn('rounded-lg px-3 py-2.5', getPmMetricTone(project.pmSummary.blockedCount, 'high'))}>
                    <p className="text-[11px] font-medium">阻塞</p>
                    <p className="mt-1 text-lg font-semibold">{project.pmSummary.blockedCount}</p>
                  </div>
                  <div className={cn('rounded-lg px-3 py-2.5', getPmMetricTone(project.pmSummary.overdueCount, 'high'))}>
                    <p className="text-[11px] font-medium">逾期</p>
                    <p className="mt-1 text-lg font-semibold">{project.pmSummary.overdueCount}</p>
                  </div>
                  <div className={cn('rounded-lg px-3 py-2.5', getPmMetricTone(project.pmSummary.openRiskCount, 'medium'))}>
                    <p className="text-[11px] font-medium">风险</p>
                    <p className="mt-1 text-lg font-semibold">{project.pmSummary.openRiskCount}</p>
                  </div>
                  <div className={cn('rounded-lg px-3 py-2.5', getPmMetricTone(project.pmSummary.activeChangeCount, 'neutral'))}>
                    <p className="text-[11px] font-medium">变更</p>
                    <p className="mt-1 text-lg font-semibold">{project.pmSummary.activeChangeCount}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', weeklyReportTone.badge)}>
                    周报：{weeklyReportTone.label}
                  </span>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getPmMetricTone(project.pmSummary.dueSoonCount, 'medium'))}>
                    近 3 天到期：{project.pmSummary.dueSoonCount}
                  </span>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', getPmMetricTone(project.pmSummary.milestoneRiskCount, 'high'))}>
                    里程碑风险：{project.pmSummary.milestoneRiskCount}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {project.pmSummary.highlights.length === 0 ? (
                    <p className="text-xs text-slate-400">当前没有明显异常信号，适合继续按既定节奏推进。</p>
                  ) : (
                    project.pmSummary.highlights.map((item, index) => (
                      <div key={`${project.id}:highlight:${index}`} className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                        {item}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {project.tableHealth.map((item) => {
                  const tone = getTableHealthTone(item.state);
                  return (
                    <div key={item.key} className={cn('rounded-xl border px-3.5 py-3', tone.panel)}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-700">{item.label}</p>
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', tone.badge)}>
                          {tone.label}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{getTableHealthHint(item)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          item.webhookConfigured ? 'bg-white text-slate-600 border border-slate-200' : 'bg-slate-100 text-slate-400'
                        )}>
                          Webhook
                        </span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          item.schemaConfigured ? 'bg-white text-slate-600 border border-slate-200' : 'bg-slate-100 text-slate-400'
                        )}>
                          Schema
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-700">最近同步</p>
                  <span className="text-xs text-slate-400">帮助确认 BOT 最近动过哪些表</span>
                </div>
                <div className="mt-3 space-y-2">
                  {project.recentSyncs.length === 0 ? (
                    <p className="text-xs text-slate-400">暂无同步动态。配置完成后，等 BOT 首次写表这里就会出现记录。</p>
                  ) : (
                    project.recentSyncs.slice(0, 3).map((item) => (
                      <div key={`${project.id}:${item.key}`} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-600">{item.label}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{item.summary}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-400">{formatRecentSyncTime(item.syncedAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                <button className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  onClick={() => openEditModal(project)}>
                  编辑配置
                </button>
                <button className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  onClick={() => void runProjectMessageTest(project.id)}>
                  测试发消息
                </button>
                <div className="flex-1" />
                {deleteConfirm === project.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-600">确认删除？</span>
                    <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
                      onClick={() => void deleteProject(project.id)}>确认</button>
                    <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500"
                      onClick={() => setDeleteConfirm(null)}>取消</button>
                  </div>
                ) : (
                  <button className="rounded-lg px-3.5 py-2 text-xs font-medium text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => setDeleteConfirm(project.id)}>
                    删除
                  </button>
                )}
              </div>

              {(opState[`msg:${project.id}`] || opState[`delete:${project.id}`]) && (
                <div className="mt-2 text-xs text-slate-500">
                  {opState[`msg:${project.id}`] && <p>{opState[`msg:${project.id}`]}</p>}
                  {opState[`delete:${project.id}`] && <p>{opState[`delete:${project.id}`]}</p>}
                </div>
              )}
            </article>
            );
          })}
          {status.projects.length === 0 && (
            <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center">
              <p className="text-sm text-slate-400">暂无项目，点击上方「+ 新增项目」创建第一个项目</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tab: 链路测试 ──
  function renderTestTab() {
    if (!status) return null;
    return (
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        {/* 左：输入区 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-700">发送测试消息</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select className="rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
              value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">选择项目</option>
              {status.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
              value={testMode} onChange={(e) => setTestMode(e.target.value as 'smoke' | 'full')}>
              <option value="smoke">Smoke 模式</option>
              <option value="full">完整链路</option>
            </select>
          </div>
          <textarea className="mt-3 min-h-[120px] w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            placeholder="@助手 分析需求：登录流程优化" value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)} />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              项目：{selectedProject?.name ?? '未选择'} · {testMode === 'smoke' ? 'Smoke' : '完整链路'}
            </p>
            <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              disabled={runningTest} onClick={() => void runChainTest()}>
              {runningTest ? '执行中...' : '发送测试'}
            </button>
          </div>
        </div>

        {/* 右：结果流 */}
        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">结果流</h3>
            <p className="text-xs tracking-wide text-slate-400">
              {totalElapsedMs != null ? `${Math.round(totalElapsedMs / 100) / 10}s` : runningTest ? '执行中...' : '待执行'}
            </p>
          </div>
          <div className="mt-4 max-h-[400px] space-y-2 overflow-y-auto">
            {events.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
                暂无执行记录。发送测试消息后，每个 Agent 的执行步骤会实时显示。
              </div>
            ) : (
              events.map((event, i) => (
                <div key={`${event.label}-${i}`} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      <span className={cn(
                        'mr-1.5 inline-block h-2 w-2 rounded-full',
                        event.status === 'success' ? 'bg-emerald-400' : event.status === 'warning' ? 'bg-amber-400' : 'bg-rose-400'
                      )} />
                      {Math.round(event.elapsedMs / 10) / 100}s · {event.label}
                    </p>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      event.status === 'success' ? 'bg-emerald-500/15 text-emerald-300'
                        : event.status === 'warning' ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-rose-500/15 text-rose-300'
                    )}>
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">{event.detail}</p>
                </div>
              ))
            )}
          </div>
          <details className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-white">展开完整日志</summary>
            <div className="mt-2 max-h-[200px] space-y-1 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs">
              {rawLogs.map((line, i) => <p key={`${i}-${line.slice(0, 18)}`}>{line}</p>)}
            </div>
          </details>
        </div>
      </div>
    );
  }

  // ── Tab: 运维操作 ──
  function renderOpsTab() {
    if (!status) return null;
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-700">同步触发运维任务</h3>
          <p className="mt-1 text-xs text-slate-400">选择一个项目后，可直接同步触发日报、周报和产能快照，便于本地调试。</p>
          <select className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
            value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">请选择项目</option>
            {status.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="mt-4 grid gap-2">
            {triggerTypes.map((item) => (
              <button key={item.key}
                className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => void triggerOperation(item.key)}>
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
                {opState[item.key] && (
                  <span className={cn(
                    'ml-auto text-xs',
                    opState[item.key].startsWith('✓') ? 'text-emerald-600'
                      : opState[item.key].startsWith('✕') ? 'text-rose-600'
                      : 'text-slate-400'
                  )}>
                    {opState[item.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      {/* 顶部标题 */}
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">GW-PM 配置管理台</h1>
            <p className="mt-1 text-sm text-slate-500">
              {status?.workspace.name ?? '加载中...'} · 一个 BOT 管多个项目
            </p>
          </div>
          <button className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            onClick={() => void refreshStatus()}>
            刷新
          </button>
        </div>

        {pageError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{pageError}</div>
        )}

        {loading || !status ? (
          <div className="mt-6 grid gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            {/* 状态概览 */}
            <div className="mt-5">
              {renderStatusCards()}
            </div>

            {/* Tab 导航 */}
            <div className="mt-6 flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {tabs.map((tab) => (
                <button key={tab.key}
                  className={cn(
                    'flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition',
                    activeTab === tab.key
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  )}
                  onClick={() => setActiveTab(tab.key)}>
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 内容 */}
            <div className="mt-5">
              {activeTab === 'config' && renderConfigTab()}
              {activeTab === 'projects' && renderProjectsTab()}
              {activeTab === 'test' && renderTestTab()}
              {activeTab === 'ops' && renderOpsTab()}
            </div>
          </>
        )}
      </div>

      {/* 项目编辑 Modal */}
      {projectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setProjectModalOpen(false); }}
          role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
          <div ref={modalRef} tabIndex={-1}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
              <h3 id="project-modal-title" className="text-lg font-semibold">
                {projectForm.id ? '编辑项目配置' : '新增项目'}
              </h3>
              <button className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setProjectModalOpen(false)}>
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">项目名称</span>
                  <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                    placeholder="输入项目名称" value={projectForm.name}
                    onChange={(e) => setProjectForm((c) => ({ ...c, name: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">项目类型</span>
                  <select className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400"
                    value={projectForm.type}
                    onChange={(e) => setProjectForm((c) => ({ ...c, type: e.target.value as ProjectFormState['type'] }))}>
                    {projectTypes.map((t) => <option key={t} value={t}>{projectTypeLabels[t]}</option>)}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">企业微信群 ID（chatid）</span>
                    <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                      placeholder="wrxxxxxx" value={projectForm.groupId}
                      onChange={(e) => setProjectForm((c) => ({ ...c, groupId: e.target.value }))} />
                  </label>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">
                    获取方式：启动 Worker（npm run worker） &gt; 在企微群里 @机器人 说句话 &gt; Worker 日志会打印 chatid &gt; 复制到这里
                  </p>
                </div>
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">腾讯文档根目录 ID（选填）</span>
                  <input className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                    placeholder="选填" value={projectForm.tableRootId}
                    onChange={(e) => setProjectForm((c) => ({ ...c, tableRootId: e.target.value }))} />
                </label>
                {projectForm.id && (
                  <>
                    <div className="md:col-span-2 rounded-xl border border-sky-200 bg-sky-50 px-5 py-4">
                      <p className="text-sm font-semibold text-sky-800">腾讯智能表格 Webhook 配置指引</p>
                      <ol className="mt-2 grid gap-1.5 text-xs leading-5 text-sky-700">
                        <li><b>1.</b> 在企业微信中打开一个智能表格文档</li>
                        <li><b>2.</b> 为每种数据创建一个工作表（任务表、排期表等）</li>
                        <li><b>3.</b> 点击工作表右上角 ··· &gt; 接收外部数据 &gt; 开启</li>
                        <li><b>4.</b> 复制弹出的 Webhook 地址，粘贴到下方对应输入框</li>
                        <li><b>5.</b> 把 Webhook 示例 JSON 或 schema 映射粘到字段映射里，系统会自动提取</li>
                      </ol>
                      <p className="mt-2 text-xs text-sky-600">先配任务表即可跑通基本链路，其他表后续按需添加。</p>
                    </div>
                    {tableConfigs.map(renderTableConfig)}
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => setProjectModalOpen(false)}>
                取消
              </button>
              <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                disabled={savingProject} onClick={() => void saveProject()}>
                {savingProject ? '保存中...' : projectForm.id ? '保存配置' : '创建项目'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Toast 入场动画 */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}
