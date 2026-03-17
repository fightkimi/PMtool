'use client';

import { useEffect, useMemo, useState } from 'react';

type ProjectType = 'game_dev' | 'outsource' | 'office_app' | 'custom';

type PipelineOption = {
  id: string;
  name: string;
  description: string;
};

type TableIds = {
  task_table_id: string;
  pipeline_table_id: string;
  capacity_table_id: string;
  risk_table_id: string;
  change_table_id: string;
};

const steps = ['基本信息', '绑定企业微信', '绑定腾讯智能表格', '选择管线模板'];

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  return response.json() as Promise<T>;
}

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('custom');
  const [pmName, setPmName] = useState('');
  const [groupWebhook, setGroupWebhook] = useState('');
  const [mgmtWebhook, setMgmtWebhook] = useState('');
  const [wecomStatus, setWecomStatus] = useState<{ success?: boolean; error?: string }>({});
  const [rootId, setRootId] = useState('');
  const [tableIds, setTableIds] = useState<TableIds | null>(null);
  const [tableProgress, setTableProgress] = useState('');
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const savedProjectId = window.localStorage.getItem('gwpm_project_id');
    if (savedProjectId) {
      setProjectId(savedProjectId);
    }
  }, []);

  useEffect(() => {
    if (step === 3) {
      void requestJson<PipelineOption[]>('/api/setup/pipelines')
        .then(setPipelines)
        .catch(() => setPipelines([]));
    }
  }, [step]);

  const tableLinks = useMemo(() => {
    if (!tableIds) {
      return [];
    }

    return Object.entries(tableIds).map(([key, value]) => ({
      key,
      value,
      href: `https://docs.qq.com/sheet/${value}`
    }));
  }, [tableIds]);

  async function handleCreateProject() {
    if (!projectName.trim()) {
      setError('项目名称必填');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await requestJson<{ project_id: string }>('/api/setup/project', {
        method: 'POST',
        body: JSON.stringify({
          name: projectName,
          type: projectType,
          pm_name: pmName
        })
      });
      setProjectId(result.project_id);
      window.localStorage.setItem('gwpm_project_id', result.project_id);
      setStep(1);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleValidateWeCom() {
    if (!groupWebhook.trim()) {
      setWecomStatus({ success: false, error: '请输入项目群 Webhook URL' });
      return;
    }

    const result = await requestJson<{ success: boolean; error?: string }>('/api/setup/validate-wecom', {
      method: 'POST',
      body: JSON.stringify({ webhook_url: groupWebhook })
    });
    setWecomStatus(result);
  }

  async function handleInitTables() {
    if (!rootId.trim()) {
      setError('表格根目录 ID 必填');
      return;
    }

    setError('');
    setTableProgress('正在创建任务总表...');
    const result = await requestJson<TableIds>('/api/setup/init-tables', {
      method: 'POST',
      body: JSON.stringify({ root_id: rootId, project_name: projectName })
    });
    setTableProgress('已创建 5/5 张表格');
    setTableIds(result);
  }

  async function handleUploadPipeline(file: File | null) {
    if (!file) {
      return;
    }

    const content = await file.text();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const result = await requestJson<{ pipeline_id: string }>('/api/setup/upload-pipeline', {
      method: 'POST',
      body: JSON.stringify(parsed)
    });
    setUploadStatus(`已上传模板 ${result.pipeline_id}`);
  }

  async function handleComplete() {
    if (!projectId) {
      setError('请先创建项目');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await requestJson<{ success: boolean }>('/api/setup/complete', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          wecom_group_id: groupWebhook,
          wecom_bot_webhook: groupWebhook,
          wecom_mgmt_group_id: mgmtWebhook,
          smart_table_root_id: rootId,
          ...tableIds,
          selected_pipeline_ids: selectedPipelineIds
        })
      });
      setCompleted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1f3b2f,_#08110d_60%)] px-6 py-16 text-white">
        <section className="mx-auto max-w-3xl rounded-[32px] border border-emerald-300/20 bg-black/30 p-10 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.3em] text-emerald-200">Setup Complete</p>
          <h1 className="mt-4 text-4xl font-semibold">GW-PM 已配置完成</h1>
          <p className="mt-4 text-lg text-slate-200">在企业微信群 @助手 开始使用吧！</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f4eddc,_#d8e7dd_45%,_#9cb8a6)] px-6 py-10 text-slate-900">
      <section className="mx-auto max-w-5xl rounded-[32px] border border-black/10 bg-white/80 p-8 shadow-[0_24px_100px_rgba(22,40,28,0.18)] backdrop-blur">
        <div className="flex flex-wrap gap-3">
          {steps.map((label, index) => (
            <div
              key={label}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                index === step ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {index + 1}. {label}
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] bg-white p-6 shadow-sm">
            {step === 0 && (
              <div className="space-y-4">
                <h1 className="text-3xl font-semibold">Step 1. 基本信息</h1>
                <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                <select className="w-full rounded-2xl border border-slate-200 px-4 py-3" value={projectType} onChange={(event) => setProjectType(event.target.value as ProjectType)}>
                  <option value="game_dev">game_dev</option>
                  <option value="outsource">outsource</option>
                  <option value="office_app">office_app</option>
                  <option value="custom">custom</option>
                </select>
                <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="PM 姓名" value={pmName} onChange={(event) => setPmName(event.target.value)} />
                <button className="rounded-full bg-slate-900 px-6 py-3 text-white" disabled={submitting} onClick={() => void handleCreateProject()}>
                  下一步
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h1 className="text-3xl font-semibold">Step 2. 绑定企业微信</h1>
                <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="https://qyapi.weixin.qq.com/..." value={groupWebhook} onChange={(event) => setGroupWebhook(event.target.value)} />
                <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="管理层群 Webhook URL（可选）" value={mgmtWebhook} onChange={(event) => setMgmtWebhook(event.target.value)} />
                <div className="flex gap-3">
                  <button className="rounded-full bg-emerald-700 px-6 py-3 text-white" onClick={() => void handleValidateWeCom()}>
                    发送测试消息
                  </button>
                  <button className="rounded-full bg-slate-900 px-6 py-3 text-white" onClick={() => setStep(2)}>
                    下一步
                  </button>
                </div>
                {wecomStatus.success && <p className="text-sm text-emerald-700">测试消息已发送，请在群内确认</p>}
                {wecomStatus.success === false && <p className="text-sm text-rose-600">{wecomStatus.error ?? '验证失败'}</p>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h1 className="text-3xl font-semibold">Step 3. 绑定腾讯智能表格</h1>
                <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="表格根目录 ID（如 xxxxx）" value={rootId} onChange={(event) => setRootId(event.target.value)} />
                <div className="flex gap-3">
                  <button className="rounded-full bg-emerald-700 px-6 py-3 text-white" onClick={() => void handleInitTables()}>
                    自动初始化表格
                  </button>
                  <button className="rounded-full bg-slate-900 px-6 py-3 text-white" onClick={() => setStep(3)}>
                    下一步
                  </button>
                </div>
                {tableProgress && <p className="text-sm text-slate-600">{tableProgress}</p>}
                <div className="space-y-2">
                  {tableLinks.map((item) => (
                    <a key={item.key} className="block text-sm text-emerald-700 underline" href={item.href} target="_blank" rel="noreferrer">
                      {item.key}: {item.value}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h1 className="text-3xl font-semibold">Step 4. 选择管线模板</h1>
                <div className="space-y-3">
                  {pipelines.map((pipeline) => (
                    <label key={pipeline.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPipelineIds.includes(pipeline.id)}
                        onChange={(event) =>
                          setSelectedPipelineIds((current) =>
                            event.target.checked ? [...current, pipeline.id] : current.filter((id) => id !== pipeline.id)
                          )
                        }
                      />
                      <span>
                        <span className="block font-medium">{pipeline.name}</span>
                        <span className="text-sm text-slate-500">{pipeline.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <input type="file" accept="application/json" onChange={(event) => void handleUploadPipeline(event.target.files?.[0] ?? null)} />
                {uploadStatus && <p className="text-sm text-emerald-700">{uploadStatus}</p>}
                <button className="rounded-full bg-slate-900 px-6 py-3 text-white" disabled={submitting} onClick={() => void handleComplete()}>
                  完成配置
                </button>
              </div>
            )}

            {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
          </div>

          <aside className="rounded-[28px] bg-slate-900 p-6 text-slate-100">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Wizard State</p>
            <dl className="mt-6 space-y-4 text-sm">
              <div>
                <dt className="text-slate-400">Project ID</dt>
                <dd className="mt-1 break-all">{projectId || '尚未创建'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">项目名称</dt>
                <dd className="mt-1">{projectName || '--'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">已选模板</dt>
                <dd className="mt-1">{selectedPipelineIds.length}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
