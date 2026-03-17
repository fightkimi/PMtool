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

当前仓库已完成第一版工程骨架，包括：

- Next.js 14 + TypeScript 基础工程
- App Router 与初始化 H5 页面
- Agent、Adapter、Worker 目录结构
- Drizzle 配置与基础 schema
- Vitest 测试配置
- Codex setup 脚本

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
