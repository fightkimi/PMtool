## 技术方案：Workspace 级 Adapter 配置 UI 化

### 1. 背景与目标

- **问题**：BOT ID/Secret、AI API Key 等 Adapter 配置目前只能通过 `.env` 文件设置，修改后需重启服务。用户需要一个 UI 界面来配置这些参数，实现运行时热更新。
- **验收标准**：
  1. Dashboard"区块一·企业配置"中可编辑并保存 BOT ID、BOT Secret
  2. 可编辑并保存 AI 默认模型和各 Provider API Key
  3. 配置保存到 `workspace.adapterConfig`（DB），`registry` 优先从 DB 读取，fallback 到 `.env`
  4. 保存后 registry 热更新，无需重启
  5. Secret 类字段明文显示
- **不做**：腾讯文档配置（已在项目编辑弹窗中，是项目级的）、GitHub Token 配置、Agent 级模型覆盖

### 2. 现状分析

| 模块 | 文件 | 现状 |
|------|------|------|
| Workspace 表 | `src/lib/schema/workspace.ts` | 已有 `adapterConfig` jsonb 字段，当前未使用 |
| Registry 单例 | `src/adapters/registry.ts` | 模块加载时从 `process.env` 初始化，不支持更新 |
| Status API | `src/app/api/setup/_dashboard.ts` | `buildSetupStatus` 从 env 读 bot/ai 状态 |
| Status API | `src/app/api/setup/_status.ts` | GET 返回状态，PATCH 只能改企业名称 |
| Dashboard UI | `src/app/(setup)/dashboard/DashboardClient.tsx` | BOT/AI 状态只读展示 |

### 3. 方案设计

**整体思路**：将 Adapter 配置持久化到 `workspace.adapterConfig`，registry 支持运行时从 DB 重载。Dashboard 加编辑表单，保存时写 DB + 刷新 registry。

#### 3.1 AdapterConfig 数据结构

`workspace.adapterConfig` 存储以下结构（所有字段可选，缺失则 fallback 到 env）：

```typescript
type WorkspaceAdapterConfig = {
  wecom?: {
    botId?: string;
    botSecret?: string;
    mode?: 'bot' | 'webhook';
  };
  ai?: {
    defaultModel?: string;
    anthropicApiKey?: string;
    zhipuApiKey?: string;
    deepseekApiKey?: string;
    arkApiKey?: string;
    minimaxApiKey?: string;
  };
};
```

#### 3.2 具体改动点

**文件 1：`src/adapters/registry.ts`**
- 添加 `reloadFromConfig(config: Record<string, unknown>)` 方法
- 合并逻辑：DB config 字段有值则覆盖 env，没有则保留 env 值
- 重新实例化对应的 adapter

**文件 2：`src/app/api/setup/_dashboard.ts`**
- `buildSetupStatus` 增加参数 `adapterConfig`，优先从中读取 bot/ai 状态
- 新增 `updateWorkspaceAdapterConfig(workspaceId, config)` 函数

**文件 3：`src/app/api/setup/_status.ts`**
- PATCH 扩展支持 `adapterConfig` 字段
- 保存后调用 `registry.reloadFromConfig()`

**文件 4：`src/app/(setup)/dashboard/DashboardClient.tsx`**
- "区块一·企业配置"中加入可编辑的 BOT 和 AI 配置表单
- BOT 区域：BOT ID 输入框 + BOT Secret 输入框
- AI 区域：默认模型下拉框 + 各 Provider API Key 输入框
- 保存按钮统一提交到 PATCH `/api/setup/status`

### 4. 实施计划

| 步骤 | 内容 | 涉及文件 | 验证方式 |
|------|------|---------|---------|
| 1 | registry 添加 reloadFromConfig 方法 | `registry.ts` | 单元测试 |
| 2 | _dashboard 添加 adapterConfig 读写 | `_dashboard.ts` | status API 返回 DB 中的配置 |
| 3 | _status PATCH 扩展 | `_status.ts` | PATCH 请求能保存配置 |
| 4 | Dashboard UI 表单 | `DashboardClient.tsx` | 页面可编辑保存 |
| 5 | typecheck + test | - | 全部通过 |

### 5. 风险与边界

- **热更新边界**：WeCom Bot 的 WebSocket 连接由 worker 进程管理，Dashboard 修改 BOT 配置后 registry 更新，但**已建立的 WebSocket 连接不会断开重连**。首次配置 OK，后续换 BOT 需要重启 worker。这个限制本次不解决，文档标注清楚。
- **env 优先级**：DB 有值 > env 有值 > 默认值。不清空 DB 字段时 env 值无效。
- **敏感信息**：用户选择明文显示，无脱敏需求。
- **不做**：腾讯文档全局配置（webhook 模式下是项目级）、GitHub Token、Agent 级模型覆盖配置。
