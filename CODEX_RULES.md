# Codex 开发规范（每次任务必须遵守）

## 文件组织规则
- 测试文件：只放在 src/__tests__/unit/ 或 src/__tests__/integration/ 或 src/__tests__/e2e/
- 调试脚本：只放在 scripts/debug/，且优先复用现有脚本，不新建
- 种子数据：只放在 scripts/seed/
- 不在任何业务代码目录（src/agents/ src/adapters/ src/lib/ 等）内创建测试文件

## 禁止行为
- 不创建一次性验证脚本（用完就删的临时文件）
- 不为同一模块创建多个测试文件，新测试用例追加到已有文件里
- 不创建 *.temp.ts / *.bak.ts / *.old.ts 文件
- 不在 src/ 外创建任何 TypeScript 业务逻辑文件

## 每次任务结束必须自查
1. npm run typecheck 通过
2. npm run test 通过
3. 没有游离在 src/__tests__/ 之外的测试文件
4. 没有不在保留列表里的 scripts/ 文件
