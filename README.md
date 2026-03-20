# GW-PM

GW-PM 是一个 AI 项目管理引擎，本身不提供完整独立界面。

## 产品形态

- 企业微信机器人：操作入口
- 腾讯智能表格：数据展示
- GW-PM 后端：Agent 引擎与任务编排

## 技术栈

- Next.js 14 App Router
- TypeScript strict mode
- Drizzle ORM
- PostgreSQL
- Redis
- BullMQ

## 当前阶段

当前仓库已进入 AI PM 引擎 Alpha 阶段，已经具备可联调的主链路：

- 企业微信消息入口与意图路由
- 中枢 / 中书省 / 门下省 / 尚书省主链路
- Setup / Dashboard 配置页
- Workspace 级适配器配置与热加载
- 任务、排期、风险、产能、周报、复盘等基础数据模型
- Worker、队列和定时任务

当前仍在持续补齐：

- 测试基线与稳定性
- 腾讯智能表格真实联调
- 部分占位模块实现
- 文档与运行手册

## 常用命令

```bash
npm run dev
npm run typecheck
npm run lint
npm run test
npm run db:generate
npm run db:migrate
npm run worker
```

## 调试命令

```bash
# Mock 模式（快速验证流程）
npx tsx scripts/debug/simWecom.ts --project demo-project --msg "@助手 分析需求：登录流程优化"

# 真实 AI 模式（验证输出质量）
npx tsx scripts/debug/simWecom.ts --project demo-project --msg "@助手 分析需求：登录流程优化" --real-ai
```

## 目录概览

```text
src/
  app/
  agents/
  adapters/
  lib/
  types/
  workers/
  __tests__/
```

## 当前产品形态

- 企业微信机器人：操作入口
- 腾讯智能表格：结果展示与同步
- PMtool 后端：Agent 编排与自动化执行

当前并不提供完整的传统 PM Web 前台。

## 环境变量

复制 `.env.example` 后按实际环境填写：

- 数据库连接
- Redis 连接
- Claude / DeepSeek API Key
- GitHub Token
- 企业微信配置
- 腾讯智能表格配置

## 验收

```bash
npm run typecheck
npm run lint
npm run test -- src/__tests__/unit/setup.test.ts
echo "TASK 00 DONE"
```
