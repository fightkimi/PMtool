'use client';

import { useEffect, useMemo, useState } from 'react';

type SetupStatusResponse = {
  workspace: { id: string; name: string };
  bot: { configured: boolean; botIdPreview: string | null; connected: boolean };
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
  projects: Array<{
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
  }>;
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

const projectTypes: ProjectFormState['type'][] = ['game_dev', 'outsource', 'office_app', 'custom'];
const triggerTypes = [
  { key: 'daily_scan', label: '立即触发日报' },
  { key: 'weekly_report', label: '触发周报' },
  { key: 'capacity_snapshot', label: '触发产能快照' }
] as const;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  const data = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `请求失败 (${response.status})`);
  }

  return data;
}

function createEmptyProjectForm(): ProjectFormState {
  return {
    name: '',
    type: 'custom',
    groupId: '',
    mgmtGroupId: '',
    tableRootId: '',
    taskTableWebhook: '',
    taskTableSchema: '',
    pipelineTableWebhook: '',
    pipelineTableSchema: '',
    capacityTableWebhook: '',
    capacityTableSchema: '',
    riskTableWebhook: '',
    riskTableSchema: '',
    changeTableWebhook: '',
    changeTableSchema: ''
  };
}

function stringifySchema(value: Record<string, string> | null | undefined): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
}

function parseSchemaJson(value: string): Record<string, string> {
  if (!value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('字段映射必须是 JSON 对象');
  }

  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key, String(item)]));
}

function formatBool(status: boolean, ok = '已配置', empty = '未配置') {
  return status ? `✅ ${ok}` : `⚪ ${empty}`;
}

function formatBadge(status: StreamEvent['status']) {
  if (status === 'success') return '✅';
  if (status === 'warning') return '⚠️';
  return '❌';
}

export function DashboardClient() {
  const [status, setStatus] = useState<SetupStatusResponse | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
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

  async function refreshStatus() {
    setLoading(true);
    setPageError('');
    try {
      const data = await requestJson<SetupStatusResponse>('/api/setup/status');
      setStatus(data);
      setWorkspaceName(data.workspace.name);
      setSelectedProjectId((current) => current || data.projects[0]?.id || '');
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  const selectedProject = useMemo(
    () => status?.projects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, status?.projects]
  );

  async function runWorkspacePatch() {
    const result = await requestJson<{ workspace?: { id: string; name: string }; error?: string }>('/api/setup/status', {
      method: 'PATCH',
      body: JSON.stringify({ name: workspaceName })
    });
    if (result.error) {
      throw new Error(result.error);
    }
    await refreshStatus();
  }

  async function handleQuickTest(key: 'wecom' | 'ai' | 'tencentdoc') {
    setOpState((current) => ({ ...current, [key]: '测试中...' }));
    try {
      const body =
        key === 'wecom' && selectedProjectId
          ? JSON.stringify({ projectId: selectedProjectId })
          : key === 'ai'
            ? JSON.stringify({})
            : undefined;
      const result = await requestJson<OperationResult>(`/api/setup/test-${key}`, {
        method: 'POST',
        body
      });
      setOpState((current) => ({
        ...current,
        [key]: result.success
          ? `✅ 成功${result.latencyMs ? ` · ${result.latencyMs}ms` : ''}${result.model ? ` · ${result.model}` : ''}`
          : `❌ ${result.error ?? '失败'}`
      }));
    } catch (error) {
      setOpState((current) => ({ ...current, [key]: `❌ ${error instanceof Error ? error.message : '失败'}` }));
    }
  }

  function openCreateModal() {
    setProjectForm(createEmptyProjectForm());
    setProjectModalOpen(true);
  }

  function openEditModal(project: SetupStatusResponse['projects'][number]) {
    setProjectForm({
      id: project.id,
      name: project.name,
      type: project.type,
      groupId: project.groupId ?? '',
      mgmtGroupId: project.mgmtGroupId ?? '',
      tableRootId: project.tableRootId ?? '',
      taskTableWebhook: project.taskTableWebhook ?? '',
      taskTableSchema: stringifySchema(project.taskTableSchema),
      pipelineTableWebhook: project.pipelineTableWebhook ?? '',
      pipelineTableSchema: stringifySchema(project.pipelineTableSchema),
      capacityTableWebhook: project.capacityTableWebhook ?? '',
      capacityTableSchema: stringifySchema(project.capacityTableSchema),
      riskTableWebhook: project.riskTableWebhook ?? '',
      riskTableSchema: stringifySchema(project.riskTableSchema),
      changeTableWebhook: project.changeTableWebhook ?? '',
      changeTableSchema: stringifySchema(project.changeTableSchema)
    });
    setProjectModalOpen(true);
  }

  async function saveProject() {
    if (!projectForm.name.trim()) {
      setPageError('项目名称必填');
      return;
    }

    setSavingProject(true);
    setPageError('');
    try {
      if (projectForm.id) {
        await requestJson(`/api/setup/projects/${projectForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: projectForm.name,
            type: projectForm.type,
            groupId: projectForm.groupId,
            mgmtGroupId: projectForm.mgmtGroupId,
            tableRootId: projectForm.tableRootId,
            taskTableWebhook: projectForm.taskTableWebhook,
            taskTableSchema: parseSchemaJson(projectForm.taskTableSchema),
            pipelineTableWebhook: projectForm.pipelineTableWebhook,
            pipelineTableSchema: parseSchemaJson(projectForm.pipelineTableSchema),
            capacityTableWebhook: projectForm.capacityTableWebhook,
            capacityTableSchema: parseSchemaJson(projectForm.capacityTableSchema),
            riskTableWebhook: projectForm.riskTableWebhook,
            riskTableSchema: parseSchemaJson(projectForm.riskTableSchema),
            changeTableWebhook: projectForm.changeTableWebhook,
            changeTableSchema: parseSchemaJson(projectForm.changeTableSchema)
          })
        });
      } else {
        await requestJson('/api/setup/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: projectForm.name,
            type: projectForm.type,
            groupId: projectForm.groupId,
            tableRootId: projectForm.tableRootId
          })
        });
      }

      setProjectModalOpen(false);
      await refreshStatus();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject(projectId: string) {
    setOpState((current) => ({ ...current, [`delete:${projectId}`]: '删除中...' }));
    await requestJson(`/api/setup/projects/${projectId}`, { method: 'DELETE' });
    setOpState((current) => ({ ...current, [`delete:${projectId}`]: '✅ 已归档' }));
    await refreshStatus();
  }

  async function runProjectMessageTest(projectId: string) {
    setOpState((current) => ({ ...current, [`msg:${projectId}`]: '发送中...' }));
    const result = await requestJson<OperationResult>('/api/setup/test-wecom', {
      method: 'POST',
      body: JSON.stringify({ projectId })
    });
    setOpState((current) => ({
      ...current,
      [`msg:${projectId}`]: result.success ? `✅ ${result.latencyMs ?? 0}ms` : `❌ ${result.error ?? '失败'}`
    }));
  }

  async function triggerOperation(type: (typeof triggerTypes)[number]['key']) {
    if (!selectedProjectId && type !== 'capacity_snapshot') {
      setPageError('请先选择项目');
      return;
    }

    setOpState((current) => ({ ...current, [type]: '执行中...' }));
    const result = await requestJson<{ success: boolean; error?: string; agentType?: string }>('/api/agents/trigger', {
      method: 'POST',
      body: JSON.stringify({ type, projectId: selectedProjectId || undefined })
    });
    setOpState((current) => ({
      ...current,
      [type]: result.success ? `✅ ${result.agentType ?? ''}` : `❌ ${result.error ?? '失败'}`
    }));
  }

  async function runChainTest() {
    if (!selectedProjectId) {
      setPageError('请先选择一个项目');
      return;
    }

    setEvents([]);
    setRawLogs([]);
    setTotalElapsedMs(null);
    setRunningTest(true);
    setPageError('');

    try {
      const response = await fetch('/api/setup/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          message: testMessage,
          mode: testMode
        })
      });

      if (!response.ok || !response.body) {
        throw new Error('链路测试启动失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk
            .split('\n')
            .find((item) => item.startsWith('data: '))
            ?.slice(6);
          if (!line) {
            continue;
          }

          setRawLogs((current) => [...current, line]);
          const parsed = JSON.parse(line) as StreamEvent | { done: true; totalMs: number };
          if ('done' in parsed) {
            setTotalElapsedMs(parsed.totalMs);
          } else {
            setEvents((current) => [...current, parsed]);
          }
        }
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '链路测试失败');
    } finally {
      setRunningTest(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,_#eef4ee,_#f8efe1_44%,_#d5e4ec)] px-6 py-8 text-slate-900">
      <section className="mx-auto max-w-7xl rounded-[36px] border border-slate-200/80 bg-white/88 p-8 shadow-[0_28px_100px_rgba(26,44,36,0.14)] backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Workspace Dashboard</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">GW-PM 配置管理台</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              一个 Workspace 对应一家公司，一个 BOT 管多个项目；每个项目绑定一个企业微信群和多张企业微信智能表格 Webhook。
            </p>
          </div>
          <button
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            onClick={() => void refreshStatus()}
          >
            刷新状态
          </button>
        </div>

        {pageError && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{pageError}</div>
        )}

        {loading || !status ? (
          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-48 animate-pulse rounded-[28px] bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="mt-8 grid gap-6">
            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-500">区块一 · 企业配置</p>
                    <h2 className="mt-2 text-2xl font-semibold">Workspace 级全局配置</h2>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500">企业名称</span>
                    <input
                      className="mt-3 w-full bg-transparent text-lg font-medium outline-none"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">BOT 状态</p>
                    <p className="mt-3 text-lg font-medium">
                      {status.bot.botIdPreview ?? '未配置'} · {status.bot.connected ? '✅ 已连接' : '❌ 未连接'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">AI 模型</p>
                    <p className="mt-3 text-lg font-medium">{status.ai.defaultModel}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {Object.entries(status.ai.providers).map(([key, configured]) => (
                        <span
                          key={key}
                          className={cn(
                            'rounded-full px-3 py-1 font-medium',
                            configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          )}
                        >
                          {configured ? '✅' : '⚪'} {key}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">腾讯文档 / 智能表格</p>
                    <p className="mt-3 text-lg font-medium">
                      {status.tencentdoc.appIdPreview ?? '未配置'} · {status.tencentdoc.configured ? '✅ 已配置' : '❌ 未配置'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white" onClick={() => void runWorkspacePatch()}>
                    保存企业名称
                  </button>
                  <button className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium" onClick={() => void handleQuickTest('wecom')}>
                    测试 BOT 连接
                  </button>
                  <button className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium" onClick={() => void handleQuickTest('ai')}>
                    测试 AI 调用
                  </button>
                  <button className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium" onClick={() => void handleQuickTest('tencentdoc')}>
                    测试腾讯文档 Webhook
                  </button>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  {['wecom', 'ai', 'tencentdoc'].map((key) =>
                    opState[key] ? <p key={key}>{opState[key]}</p> : null
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(145deg,_#0f172a,_#111827)] p-6 text-white shadow-sm">
                <p className="text-sm font-medium text-slate-300">区块四 · 运维操作</p>
                <h2 className="mt-2 text-2xl font-semibold">同步执行运维按钮</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">选择一个项目后，可直接同步触发日报、周报和产能快照，便于本地调试。</p>
                <select
                  className="mt-6 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                >
                  <option value="">请选择项目</option>
                  {status.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <div className="mt-6 grid gap-3">
                  {triggerTypes.map((item) => (
                    <button
                      key={item.key}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium transition hover:bg-white/10"
                      onClick={() => void triggerOperation(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300">
                  {triggerTypes.map((item) =>
                    opState[item.key] ? <p key={item.key}>{opState[item.key]}</p> : null
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">区块二 · 项目列表</p>
                  <h2 className="mt-2 text-2xl font-semibold">Project 级配置</h2>
                </div>
                <button className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-medium text-white" onClick={openCreateModal}>
                  + 新增项目
                </button>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {status.projects.map((project) => (
                  <article key={project.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold">{project.name}</h3>
                        <p className="mt-2 text-sm text-slate-500">
                          群 ID：{project.groupId ? `${project.groupId.slice(0, 10)}***` : '未配置'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-semibold',
                          project.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : project.status === 'planning'
                              ? 'bg-amber-100 text-amber-700'
                              : project.status === 'completed'
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-rose-100 text-rose-700'
                        )}
                      >
                        {project.status}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <p>{project.groupId ? '✅ 已配置群 ID' : '⚪ 未配置群 ID'}</p>
                      <p>{formatBool(project.tables.task, '已绑定任务表 Webhook', '未绑定任务表 Webhook')}</p>
                      <p>{formatBool(project.tables.pipeline, '已绑定管线排期表 Webhook', '未绑定管线排期表 Webhook')}</p>
                      <p>{formatBool(project.tables.capacity, '已绑定产能表 Webhook', '未绑定产能表 Webhook')}</p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium" onClick={() => openEditModal(project)}>
                        编辑配置
                      </button>
                      <button className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium" onClick={() => void runProjectMessageTest(project.id)}>
                        测试发消息
                      </button>
                      <button className="rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600" onClick={() => void deleteProject(project.id)}>
                        删除
                      </button>
                    </div>

                    <div className="mt-3 grid gap-1 text-xs text-slate-500">
                      {opState[`msg:${project.id}`] && <p>{opState[`msg:${project.id}`]}</p>}
                      {opState[`delete:${project.id}`] && <p>{opState[`delete:${project.id}`]}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">区块三 · 链路测试</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                <h2 className="text-2xl font-semibold">实时链路调试</h2>
                <div className="flex flex-wrap gap-3">
                  <select
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm"
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                  >
                    <option value="">选择项目</option>
                    {status.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm"
                    value={testMode}
                    onChange={(event) => setTestMode(event.target.value as 'smoke' | 'full')}
                  >
                    <option value="smoke">Smoke</option>
                    <option value="full">完整链路</option>
                  </select>
                </div>
              </div>

              <textarea
                className="mt-5 min-h-[104px] w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none"
                placeholder="@助手 分析需求：登录流程优化"
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
              />

              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-sm text-slate-500">
                  当前项目：{selectedProject?.name ?? '未选择'} · 模式：{testMode === 'smoke' ? 'Smoke' : '完整链路'}
                </p>
                <button
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                  disabled={runningTest}
                  onClick={() => void runChainTest()}
                >
                  {runningTest ? '执行中...' : '发送测试'}
                </button>
              </div>

              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-950 px-5 py-5 text-slate-100">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-lg font-semibold">结果流</h3>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                    {totalElapsedMs != null ? `总耗时：${Math.round(totalElapsedMs / 100) / 10}s` : runningTest ? '执行中' : '待执行'}
                  </p>
                </div>
                <div className="mt-4 grid gap-3">
                  {events.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
                      暂无执行记录，发送一条测试消息后会实时显示每个 Agent 的执行步骤。
                    </div>
                  ) : (
                    events.map((event, index) => (
                      <div key={`${event.label}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-medium">
                            {formatBadge(event.status)} {Math.round(event.elapsedMs / 10) / 100}s · {event.label}
                          </p>
                          <span
                            className={cn(
                              'rounded-full px-2.5 py-1 text-xs font-semibold',
                              event.status === 'success'
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : event.status === 'warning'
                                  ? 'bg-amber-500/15 text-amber-200'
                                  : 'bg-rose-500/15 text-rose-200'
                            )}
                          >
                            {event.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{event.detail}</p>
                      </div>
                    ))
                  )}
                </div>
                <details className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                  <summary className="cursor-pointer font-medium text-white">展开完整日志</summary>
                  <div className="mt-3 grid gap-2 whitespace-pre-wrap break-all font-mono text-xs">
                    {rawLogs.map((line, index) => (
                      <p key={`${index}-${line.slice(0, 18)}`}>{line}</p>
                    ))}
                  </div>
                </details>
              </div>
            </section>
          </div>
        )}
      </section>

      {projectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">{projectForm.id ? '编辑项目配置' : '新增项目'}</p>
                <h3 className="mt-2 text-2xl font-semibold">项目基础信息</h3>
              </div>
              <button className="rounded-full border border-slate-300 px-4 py-2 text-sm" onClick={() => setProjectModalOpen(false)}>
                关闭
              </button>
            </div>

            <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-4 md:grid-cols-2">
              <input
                className="rounded-2xl border border-slate-200 px-4 py-3"
                placeholder="项目名称"
                value={projectForm.name}
                onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
              />
              <select
                className="rounded-2xl border border-slate-200 px-4 py-3"
                value={projectForm.type}
                onChange={(event) =>
                  setProjectForm((current) => ({ ...current, type: event.target.value as ProjectFormState['type'] }))
                }
              >
                {projectTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input
                className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2"
                placeholder="企业微信群 ID（在群里 @机器人 发“群ID”获取）"
                value={projectForm.groupId}
                onChange={(event) => setProjectForm((current) => ({ ...current, groupId: event.target.value }))}
              />
              <input
                className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2"
                placeholder="腾讯文档根目录 ID（选填）"
                value={projectForm.tableRootId}
                onChange={(event) => setProjectForm((current) => ({ ...current, tableRootId: event.target.value }))}
              />
              {projectForm.id && (
                <>
                  <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="任务表 Webhook 地址：https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx" value={projectForm.taskTableWebhook} onChange={(event) => setProjectForm((current) => ({ ...current, taskTableWebhook: event.target.value }))} />
                  <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm md:col-span-2" placeholder='任务表字段映射（Schema JSON）&#10;{"fzSueb":"所属项目","f8b2fT":"功能"}' value={projectForm.taskTableSchema} onChange={(event) => setProjectForm((current) => ({ ...current, taskTableSchema: event.target.value }))} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="管线排期表 Webhook 地址：https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx" value={projectForm.pipelineTableWebhook} onChange={(event) => setProjectForm((current) => ({ ...current, pipelineTableWebhook: event.target.value }))} />
                  <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm md:col-span-2" placeholder='管线排期表字段映射（Schema JSON）&#10;{"field_xxx":"阶段"}' value={projectForm.pipelineTableSchema} onChange={(event) => setProjectForm((current) => ({ ...current, pipelineTableSchema: event.target.value }))} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="产能表 Webhook 地址：https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx" value={projectForm.capacityTableWebhook} onChange={(event) => setProjectForm((current) => ({ ...current, capacityTableWebhook: event.target.value }))} />
                  <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm md:col-span-2" placeholder='产能表字段映射（Schema JSON）&#10;{"field_xxx":"成员"}' value={projectForm.capacityTableSchema} onChange={(event) => setProjectForm((current) => ({ ...current, capacityTableSchema: event.target.value }))} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="风险表 Webhook 地址：https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx" value={projectForm.riskTableWebhook} onChange={(event) => setProjectForm((current) => ({ ...current, riskTableWebhook: event.target.value }))} />
                  <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm md:col-span-2" placeholder='风险表字段映射（Schema JSON）&#10;{"field_xxx":"风险描述"}' value={projectForm.riskTableSchema} onChange={(event) => setProjectForm((current) => ({ ...current, riskTableSchema: event.target.value }))} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="变更表 Webhook 地址：https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=xxx" value={projectForm.changeTableWebhook} onChange={(event) => setProjectForm((current) => ({ ...current, changeTableWebhook: event.target.value }))} />
                  <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm md:col-span-2" placeholder='变更表字段映射（Schema JSON）&#10;{"field_xxx":"变更标题"}' value={projectForm.changeTableSchema} onChange={(event) => setProjectForm((current) => ({ ...current, changeTableSchema: event.target.value }))} />
                  <p className="md:col-span-2 text-xs leading-6 text-slate-500">
                    在企业微信智能表格工作表中开启“接收外部数据”后复制对应 Webhook 地址，并把示例数据里的 schema 字段粘贴到对应 Schema JSON。
                  </p>
                </>
              )}
              </div>
            </div>

            <div className="mt-6 flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white pt-4">
              <button className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium" onClick={() => setProjectModalOpen(false)}>
                取消
              </button>
              <button
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                disabled={savingProject}
                onClick={() => void saveProject()}
              >
                {savingProject ? '保存中...' : projectForm.id ? '保存配置' : '创建项目'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
