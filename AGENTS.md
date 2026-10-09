<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue tracker

规格与任务记录在 GitHub 仓库 Frost-96/verlark 的 Issues 中，使用 gh CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

采用 needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix 五个默认角色标签。见 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context：根目录 GLOSSARY.md 与 docs/adr/。探索和实施前按 `docs/agents/domain.md` 读取相关领域文档。
