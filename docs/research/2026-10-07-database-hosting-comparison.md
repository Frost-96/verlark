# 数据库托管比较：Supabase 与 Neon

查阅日期：2026-10-07（Asia/Shanghai）。状态：研究建议，尚未决定选型。

访谈更新：用户随后明确新版本退出 Supabase，并要求暂缓讨论音频存储，见 [ADR 0002](../adr/0002-exit-supabase.md)。下文保留 Supabase 作为技术比较基准；“继续使用 Supabase”是被用户方向排除的备选，不是当前实施建议。Neon 尚待最终选择。

## 结论与适用前提

在可以放弃旧数据、重新设计学习模型的前提下，Neon 值得作为新数据库候选；不需要先把即将废弃的 Prisma 模型完整搬过去。选择理由应是期望的开发分支流程、部署方式和运维边界，不能预设 Neon 比 Supabase 更快、更便宜或必然修复当前连接故障。这是结合下面事实作出的工程判断，尚无本项目对照实测。

ORM 与托管供应商是两个独立决策。Supabase 提供完整 PostgreSQL；Drizzle 官方同时提供 Supabase 和 Neon 接入方式。采用 Drizzle 不要求迁出 Supabase，采用 Neon 也不要求使用某一种 ORM。标准 PostgreSQL 表结构与 SQL 有利于保留更换供应商的空间；平台特有服务、扩展和权限配置仍需逐项核对。[Supabase Database](https://supabase.com/docs/guides/database/overview)、[Drizzle + Supabase](https://orm.drizzle.team/docs/get-started/supabase-new)、[Drizzle + Neon](https://orm.drizzle.team/docs/connect-neon)。

**需要纠正旧认知：Neon 已提供对象存储。** 官方于 2026-09-17 宣布包含 Object Storage 的后端产品正式可用；因此不能把 Neon 描述为“只有数据库、无法存音频”。但换数据库连接不会自动替换项目中的 Supabase Storage SDK 调用。[Neon GA 公告](https://neon.com/blog/neon-backend-is-ga)。

## 与当前代码有关的事实

- 数据访问读取 `DATABASE_URL` 并使用 PostgreSQL adapter；供应商地址未写死。来源：`src/lib/prisma.ts:2–8`。
- 音频通过 Supabase SDK 上传、删除、签名；桶名为 `user-audio`、`ai-audio`。签名接口另检查用户路径前缀。来源：`src/lib/speaking/audioStorage.ts:8–78`、`src/app/api/speaking/getAudioURL/route.ts:48–58`。
- 当前认证为项目自有 JWT Cookie；未在 `src/` 找到 Supabase Auth / Realtime 调用。来源：`src/lib/auth-core.ts:1–55`、`src/lib/auth.ts:21–49`，以及本轮源码检索。
- 当前存在交互式事务，不能只按简单读写选择 HTTP 驱动。来源：`src/server/repositories/speaking.repository.ts:176`、`src/server/repositories/conversation.repository.ts:126`。
- 历史 QA 曾记录连接异常，但原因未定位；不能据此认定供应商本身有问题。来源：`qa/baseline/2026-10-02/REPORT.md:34`。本轮未重新运行测试。

这些是本地源码和历史记录，不是线上状态证明。本轮未读取 `.env`、连接云端、创建资源或执行迁移。

## 能力比较

| 维度 | Supabase | Neon | 对本项目的意义 |
| --- | --- | --- | --- |
| 数据库与 ORM | 完整 PostgreSQL，可由 Drizzle 直连 | Drizzle 支持标准 PostgreSQL 驱动及 Neon HTTP/WebSocket 驱动 | 先定新领域模型，再定驱动；ORM 不应捆绑供应商 |
| 分支 | 独立 Supabase 环境；默认不含生产数据或 Storage 对象，当前控制台支持 Include data | 数据库采用 copy-on-write 分支；对象存储也能随分支隔离 | 两者都有预览环境，不能说 Supabase 没有分支或永远只能复制 schema |
| 连接 | 提供 direct、shared pooler session/transaction 和付费 dedicated pooler；连接方式按运行环境选择 | 提供 PgBouncer 池化连接，也可使用 HTTP/WebSocket 驱动 | 池化解决连接复用，不代表无限查询吞吐，也不等于免去事务设计 |
| 闲置计算 | 本轮不将 Supabase 项目暂停与 Neon 每次请求自动唤醒作等价比较 | 可配置 scale-to-zero；闲置后恢复计算会增加首个请求延迟 | 对实时口语需要分别测冷启动、热查询与首次音频响应 |
| 私有文件 | 私有桶支持限时签名 URL | 官方宣布 S3 兼容对象存储正式可用，提供私有桶与 presigned URL 示例 | 两者都可作为音频候选，现有 SDK/API 仍需改写 |

表格来源：[Supabase 数据库](https://supabase.com/docs/guides/database/overview)、[Drizzle Neon 驱动](https://orm.drizzle.team/docs/connect-neon)、[Supabase 分支](https://supabase.com/docs/guides/deployment/branching)、[Neon 对象存储架构](https://neon.com/blog/building-neon-object-storage)、[Supabase 连接方式](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Neon 池化说明](https://neon.com/blog/survive-thousands-connections)、[Neon compute 管理](https://neon.com/docs/manage/endpoints/)、[Supabase 私有桶](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Neon 私有文件示例](https://neon.com/blog/building-a-private-searchable-photo-library-on-the-neon-backend)。

## 驱动、连接池与交互延迟

Neon 的 `neon()` HTTP 查询及其 `transaction()` 批量事务适合预先确定的查询；需要读取结果后再决定下一条查询的交互式事务，应使用支持该语义的 `Pool`/`Client` WebSocket 路径，或部署环境允许时使用标准 PostgreSQL 驱动。WebSocket 在部分 serverless/edge 环境中不能跨请求存活，连接生命周期必须遵循实际运行环境。不能把“Neon HTTP 支持事务”理解为与现有交互式事务完全等价。[Neon 官方驱动仓库](https://github.com/neondatabase/serverless#sessions-transactions-and-node-postgres-compatibility)。

Supabase 官方把 serverless/edge 短连接与持久后端连接分开推荐，并说明共享 transaction pooler 不支持 prepared statements；Drizzle 的 Supabase 示例也提示相应配置。Neon 使用 PgBouncer transaction pooling。两者的连接上限、事务模式和应用内 pool 都需要配套配置，不能用同一组默认值推断性能。[Supabase 连接方式](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Supabase 连接池限制](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)、[Drizzle Supabase 示例](https://orm.drizzle.team/docs/get-started/supabase-new)、[Neon 池化说明](https://neon.com/blog/survive-thousands-connections)。

Neon 文档说明 scale-to-zero 可在闲置后暂停 compute，恢复会带来额外延迟；保持活跃可避免这一段恢复开销，但增加活跃计算用量。本文不把官方描述的典型恢复时间当成本项目的延迟保证，也不据较旧文档推断当前所有套餐的可配置范围。[Neon compute 管理](https://neon.com/docs/manage/endpoints/)、[Neon 2026 年 scale-to-zero 说明](https://neon.com/blog/building-patterns-unlocked-by-scale-to-zero)。

工程建议：开发与预览环境可以优先试用闲置暂停；生产口语是否关闭暂停应由延迟预算决定。用同一应用地区、同一 schema/索引和数据集分别测：闲置后的首次数据库请求、热查询 p50/p95、创建学习会话的事务、并发保存、音频上传后首次播放。LLM、STT/TTS 与音频网络时间应独立记录，避免把端到端慢全部归到数据库。

## 音频存储的真实缺口

缺口是项目适配与验收，而非 Neon 产品不存在。Neon 官方说明对象存储使用 S3 协议；桶的 private/public_read 属性通过 Neon 配置，不能假设所有 S3 ACL 或 bucket-policy 修改 API 均可用。2026-10-05 官方示例展示私有桶上传、删除和限时签名访问。[对象存储接口边界](https://neon.com/blog/building-neon-object-storage)、[私有文件示例](https://neon.com/blog/building-a-private-searchable-photo-library-on-the-neon-backend)。

工程建议：将对象 key、所有者、内容类型与生命周期保存在新模型中，以小型存储适配层处理上传、删除、签名；不要将临时签名 URL 当持久数据。可比较 Neon DB + Neon Object Storage、Neon DB + 保留 Supabase Storage、保留 Supabase DB + Storage。旧数据可放弃，只省掉历史音频复制，不省掉未来私有访问、删除和上传失败补偿的实现。

正式使用前仍需核实目标地区的服务可用性、签名 URL/Range 请求/CORS 与浏览器音频播放、上传大小、存储限额、生命周期策略及费用。这些本轮未做云端验证；GA 公告不能代替项目适配验收。

## 成本、未知项与暂定建议

本文不列固定月费或免费额度，不断言哪家更便宜。两者的最终账单必须包含数据库计算、持久存储、分支、备份/恢复、文件存储与出网；同时需要访问频率、并发、音频大小和保留期限。官方近期已更新 Neon 免费方案，旧博客数字并不稳定。[Neon 2026-10-02 方案更新](https://neon.com/blog/neon-free-plan-1-gb-per-project)、[Supabase 官方价格页](https://supabase.com/pricing)。这些链接只作为后续核价入口，未在本轮生成完整报价。

暂定建议：若重构希望以 PostgreSQL + 服务端领域逻辑为中心，且经常创建隔离预览环境，可优先验证 Neon；若不需要新的分支流程，保留 Supabase 并换用 Drizzle 仍是可行备选。先决定部署地区、数据库访问运行时、音频存储边界与延迟预算，再落定供应商。新模型不应为了模仿旧表或采用供应商附加服务而扭曲产品结构。

资料限制：部分 Neon 文档返回 `text/markdown`，web 阅读器未能打开全文，因此使用官方搜索索引及官方产品公告交叉核查；核心 HTTP/事务语义另由官方 GitHub 驱动文档验证。具体套餐、地区、SLA、实测性能仍待选型阶段核实。Agent Reach 更新检查因 DNS 解析失败未完成，不影响已获取的官方网页证据。
