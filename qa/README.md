# QA 证据索引

## 当前验证

当前回归入口是 `pnpm test`（模块公开接口与 Adapter 边界）、`pnpm test:e2e`（中文身份与完整先听后用流程）、`pnpm db:verify`（隔离空库迁移）。安装、独立数据库和浏览器配置见 [根 README](../README.md)。实现证据见 [docs/implementation](../docs/implementation/)，本轮范围见 [#24 验收](../docs/implementation/issue-24/acceptance.md)。

注册、验证、恢复、会话撤销、跨账号隔离、草稿离开提醒、重复提交与响应丢失恢复、转写确认及版本冲突、反馈、再次作答、结束、重练、删除均由当前测试覆盖。当前规则以领域文档为准，不继承旧功能的模型或已知缺陷。

## 冻结的历史证据

[2026-10-02 报告](baseline/2026-10-02/REPORT.md)、原始 JSON／日志／源码摘要全部保留，可检索旧行为、已知失败、反例与当时验证边界。历史通过不代表当前实现通过。`fixtures/synthetic-speech.mp3` 是系统合成测试音频，保留为证据，不是用户录音。

`compare-baseline.mjs` 是仅比较结果文件的离线工具，不访问数据库或供应商，可在项目根目录运行：

```sh
node qa/compare-baseline.mjs qa/baseline/2026-10-02 /absolute/path/to/historical-run
```

缺失检查不会算通过。该工具只适用于同一旧基线的结果，不应用于首版的新领域模型。

## 已退役的执行器（#24）

以下旧功能专属脚本及辅助文件已删除；完整历史源码可在清理前提交 `ab6ac3d` 中检索（例如 `git show ab6ac3d:qa/check-baseline.mjs`）：

- `check-baseline.mjs`、`check-mock-baseline.mjs`、`check-ai-baseline.mjs`：旧注册引导、写作、Coach、自由对话及旧 AI 链路。
- `check-speech-adapters.mjs`、`check-dependencies.mjs`：旧 Prisma、Supabase、语音评分及供应商检查。
- `check-regressions.mjs`、`check-operations.mjs`：旧字数、时长、软删除和旧 JWT 行为。
- `baseline-lib.mjs`、`mock-environment.mjs`、`fixtures/auth-context.mjs`：仅供上述执行器的旧认证、数据库、模拟服务与 fixture。

不要运行旧脚本对接当前数据库、恢复旧 schema、补装旧依赖或据旧 README 调用真实供应商。适用的行为证据继续保留；真实设备、实际收信、地区访问、服务质量与用户学习效果须由对应验收记录证明，不能由开发替身或历史结果代替。
