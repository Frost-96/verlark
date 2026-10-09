# Issue tracker: GitHub

规格和任务记录在 GitHub 仓库 `Frost-96/verlark` 的 Issues 中。使用 `gh` CLI，显式传入 `--repo Frost-96/verlark`，避免远端名称或工作目录变化导致写错仓库。

## 常用操作

- 创建：`gh issue create --repo Frost-96/verlark --title "<标题>" --body-file <正文文件>`。
- 读取：`gh issue view <编号> --repo Frost-96/verlark --json number,title,body,labels,comments,state,url`。
- 列表：`gh issue list --repo Frost-96/verlark --state open --limit 100 --json number,title,body,labels`；按需用 `--label`、`--state` 筛选，完整盘点时继续分页。
- 评论：`gh issue comment <编号> --repo Frost-96/verlark --body-file <评论文件>`。
- 更新正文：`gh issue edit <编号> --repo Frost-96/verlark --body-file <正文文件>`。
- 标签：`gh issue edit <编号> --repo Frost-96/verlark --add-label "<标签>"` 或 `--remove-label "<标签>"`。
- 关闭：`gh issue close <编号> --repo Frost-96/verlark`；需要结论时先单独写评论。

多行正文先保存到临时文件，再用 `--body-file` 提交，保留实际换行。发布前检查同主题 issue，已存在时更新，不重复创建。写入后重新读取，核对正文、标签与 URL；响应不确定时先查状态再重试。

标签角色使用 [triage-labels.md](triage-labels.md) 中的映射。缺少所需标签时创建，保留已有无关标签；不覆盖既有标签定义。

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub 的 issue 与 PR 共享编号；编号类型不明确时先解析，不能把 PR 当作普通 issue 操作。

## 技能约定

- “publish to the issue tracker”：创建 GitHub issue，或更新已存在的同主题 issue，并返回其 URL。
- “fetch the relevant ticket”：读取指定 issue 的正文、标签、状态和评论。
- 仓库中的设计文档保留为领域与架构依据；issue 承载规格交付和任务状态。发布规格时处理文档链接，避免相对链接在 issue 中错误指向，也不假设未提交文档已存在于远端。
- 当前 `to-spec` 交付为 Verlark 首版实施规格，应用 `ready-for-agent` 标签；具体实施仍遵守规格内的阶段门槛和延后事项。

## Wayfinding operations

使用 wayfinder 时，map 为单个标记 `wayfinder:map` 的 issue，保存 Notes、Decisions-so-far 与 Fog；每个子任务独立成 issue，并标记 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。

优先用 GitHub sub-issues 关联子任务；不可用时在 map 正文维护任务清单，在子任务顶部记录 `Part of #<map>`。阻塞关系优先使用 GitHub 原生 issue dependencies；不可用时在正文顶部记录 `Blocked by: #<编号>`。使用原生依赖 API 时先读取 blocker 的数据库 id，不把 issue 编号或 node_id 当作数据库 id。

按 map 顺序选择开放、未认领且全部前置任务已关闭的子任务；开始前用 `gh issue edit <编号> --repo Frost-96/verlark --add-assignee @me` 认领。完成后写结论评论、关闭子任务，并将结论摘要与链接补入 map 的 Decisions-so-far。
