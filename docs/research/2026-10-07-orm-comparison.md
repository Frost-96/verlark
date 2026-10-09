# Prisma 与 Drizzle：重建前的选型研究

研究日期：2026-10-07。状态：**研究建议，尚未形成选型决策**。本轮不修改依赖、业务代码或数据库。

## 结论

**建议把 Drizzle 作为新版本的优先候选，通过一个真实学习流程验证后定案。** 用户对 Drizzle 有明确偏好，且允许放弃旧数据和重新建模，降低了迁移兼容负担；Drizzle 更显式的 SQL 与 TypeScript schema 是否适合后续维护，仍应在验证中判断。这个建议不意味着 Prisma 不适用，也不意味着换 ORM 就能提高代码质量。

当前缺少目标用例、数据规模、部署区域和性能测量。不能据此断言 Drizzle 更快、Neon 更便宜，或者重写一定比整理现有代码有效。边界清楚、权限正确、失败可恢复和变更可验证才是架构质量目标；ORM 只是实现选择。

## 核实范围与版本边界

- **本地事实：** `package.json` 中 `prisma`、`@prisma/client`、`@prisma/adapter-pg` 为 `7.6.0`，`pg` 为 `^8.20.0`。这是当前 Prisma 7 基线，不应套用旧版 Rust 引擎印象作比较。
- **公开元数据事实：** 本次读取 npm dist-tags，Drizzle ORM `latest=0.45.3`，Drizzle Kit `latest=0.31.11`，两者 `rc=1.0.0-rc.4`。Prisma `prev=7.10.0`，而 `latest=8.0.0-rc.20`。因此连 `latest` 标签也不能一律理解为无预发布后缀的稳定版本。[ORM 元数据](https://registry.npmjs.org/-/package/drizzle-orm/dist-tags)、[Kit 元数据](https://registry.npmjs.org/-/package/drizzle-kit/dist-tags)、[Prisma 元数据](https://registry.npmjs.org/-/package/prisma/dist-tags)
- **文档事实：** Drizzle 当前 Neon 指南使用 `@rc`；关系查询 v2 的升级指南同样要求 RC。不能把这些示例直接复制到 0.45.x，尤其不能混用关系定义 API。[Neon 指南](https://orm.drizzle.team/docs/connect-neon)、[关系查询升级](https://orm.drizzle.team/docs/relations-v1-v2)
- **本报告边界：** 比较 Prisma 7 与 Drizzle 0.45.x 的成熟基础能力；不把 Prisma 8 或 Drizzle 1.0 RC 的新增能力当作已确定依赖。实际开始实现时重新锁定版本。

## 能力与维护方式

| 维度 | Prisma 7 | Drizzle | 对本项目的含义 |
| --- | --- | --- | --- |
| Schema 与类型 | Prisma schema 驱动生成客户端。 | TypeScript 表定义与类型化 SQL 查询构造。 | 两者都能提供类型检查；选择哪种建模与查询方式更便于团队维护。 |
| SQL 控制 | 常规查询采用模型 API；可使用原生 SQL。TypedSQL 能生成查询参数与结果类型，但 v7 文档仍要求 preview 标记，生成时需要数据库连接。 | SQL 风格的 select/join/where 组合以及 `sql` 模板；更便于局部加入 SQL 表达式。 | 若以后需要学习数据统计，Drizzle 的表达方式可能更直接；这属于开发体验推断，不是性能结论。 |
| 类型边界 | 生成类型帮助检查查询，不能替代请求校验和业务不变量。 | `sql<T>` 中的 T 是手工类型提示，不验证 SQL 的运行时返回值；必要时需做映射与校验。 | “TypeScript 不报错”不代表数据、权限或学习规则正确。 |
| 关系查询 | 有嵌套读取、关系过滤、具备事务保障的嵌套写入；v7 的 `relationLoadStrategy` 仍是 preview。 | 0.x 已有关系查询；v1→v2 改变关系定义与查询能力。 | 不能写成“Prisma 每次关系查询必定 N+1”，也不能把 RC 的关系能力算入稳定版。 |
| 迁移 | 生成可编辑 SQL 迁移，维护版本历史；开发与部署命令分工明确。 | Kit 支持 schema pull/push、SQL generate/migrate 等工作流。 | 两者都能做可审核迁移。建议新版本提交 SQL 迁移并验证从空库重建；不用在线直接改表代替版本历史。 |
| 事务 | 支持嵌套写入、批量事务和交互式事务。 | 提供事务 API，包括 PostgreSQL 隔离级别配置；实际能力受驱动约束。 | 关键差别可能来自 HTTP/连接式驱动，而非 ORM 名称。 |

表格依据：[Prisma v7 CLI](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference)、[TypedSQL](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/typedsql)、[Prisma 关系查询](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries)、[Prisma 事务](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)、[Prisma 迁移](https://docs.prisma.io/docs/orm/v7/prisma-migrate)、[Drizzle SQL](https://orm.drizzle.team/docs/sql)、[Drizzle 关系升级](https://orm.drizzle.team/docs/relations-v1-v2)、[Drizzle 迁移](https://orm.drizzle.team/docs/migrations)、[Drizzle 事务](https://orm.drizzle.team/docs/transactions)。

## ORM 与数据库供应商可以分别选择

| 组合 | 官方支持的接入路径 |
| --- | --- |
| Prisma + Supabase | PostgreSQL + driver adapter；根据运行环境选直接连接或连接池。 |
| Prisma + Neon | PostgreSQL/`pg`，或 `@prisma/adapter-neon`。 |
| Drizzle + Supabase | PostgreSQL 驱动，例如 postgres.js。 |
| Drizzle + Neon | `node-postgres`/postgres.js，或 Neon HTTP/WebSocket 驱动。 |

四种组合均有官方接入资料。因此“选 Neon 就必须选 Drizzle”没有依据；也可以分别验证或分别切换。[Prisma v7 PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)、[Drizzle Supabase](https://orm.drizzle.team/docs/connect-supabase)、[Drizzle Neon](https://orm.drizzle.team/docs/connect-neon)

这里只确认数据库接入独立性。Supabase 的认证、对象存储等服务是否继续使用，是另外的系统依赖决策，不能由更换连接字符串推导为已解决。

## Neon 驱动建议

**事实：** Drizzle 的 Neon 接入区分 HTTP 与 WebSocket；需要会话或交互式事务时，应使用支持这些能力的连接方式。普通 PostgreSQL 驱动也能访问 Neon。[官方驱动说明](https://orm.drizzle.team/docs/connect-neon)

**建议：** 若 Next.js 继续使用 Node.js 服务端且没有确定的 Edge 需求，优先验证现有 `pg` 路径配合 Drizzle；这可以减少额外驱动变化。若部署环境要求 HTTP/Edge，再按真实事务需求选择 Neon 驱动。不要因为数据库名字带 serverless 就默认必须用 HTTP。

**架构推断：** 音频识别、模型推理或语音生成可能耗时且失败，不应让一次数据库事务跨越完整外部调用。可先保存任务状态，调用服务，再用短事务记录结果；具体状态与幂等键需在领域访谈中确定。

## 定案前最小验证

选定一个实际学习闭环后，再用候选方案验证：

1. 从空数据库执行完整迁移，运行同一组必要种子数据。
2. 一次学习记录与关联数据能够原子写入；中途失败能回滚。
3. 重复提交或外部结果重试不会重复计入学习成果。
4. 学习历史读取、关联反馈和必要统计表达清楚，查询次数与 SQL 可检查。
5. 在目标部署环境核对连接池、超时与驱动支持；只有出现性能目标时再测实际延迟。

这些是评估建议，尚未实现或通过测试。没有旧数据保留要求，可以建立新的初始 schema，但这不等于已经授权删除现有远端数据库。

## 调研方法

使用 research 工作流，只引用官方文档及官方发布的 npm 元数据；按 agent-reach 的网页路由使用 Jina Reader 读取 Drizzle 官方页面，并用 web 工具核对公开文档。未读取 `.env`、连接私有数据库或执行迁移。
