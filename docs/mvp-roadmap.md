# PM Tool 开发路线图

## Phase 0: 项目准备

- 明确产品范围与核心流程
- 选定技术栈
- 建立仓库规范与基础工程

## Phase 1: 基础工程

- 初始化前端项目
- 初始化后端与数据库
- 接入登录与权限
- 设计基础数据表

## Phase 2: 核心业务能力

- 项目管理
- 需求管理
- 任务管理
- 看板视图

## Phase 3: 迭代与可视化

- 迭代管理
- 项目概览统计
- 即将到期和风险提示

## Phase 4: 体验优化

- 搜索与筛选
- 评论与操作记录
- 更细粒度权限
- UI 与交互优化

## 建议的开发优先级

优先级从高到低：

1. 登录 / 用户
2. 项目
3. 需求
4. 任务
5. 看板
6. 迭代
7. 统计分析

## 建议的第一批数据模型

- User
- Project
- Requirement
- Task
- Sprint

## 建议的第一批接口

- `POST /api/auth/login`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/requirements`
- `POST /api/requirements`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
