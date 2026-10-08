# #2–#6 实施证据

## 实施前基线（#2）

- 当前分支 `master`，起点 `43da4c85fc88eca630cdc738916941b869b9f3bb`。工作区已存在大量未提交修改，不能用 HEAD 代表实施前文件。
- 完整选定工作区快照：`.local-snapshots/before-issues-2-6/workspace.tar.gz`；清单、SHA-256、删除状态：同目录 `manifest.json`；恢复验证：`verification.json`。该本地恢复档案不提交，不依赖旧云端资源。
- 独立恢复到 `/var/folders/x3/hmr83x655h5d_2whhyklj2x00000gn/T/verlark-restore-vjow5yk8`，331 个文件逐个比对 SHA-256，10 个删除路径验证不存在。包含未跟踪的 docs、qa、brand、GLOSSARY.md。
- 排除 `.env*`、`.mcp.json`、`.vscode/` 等机器配置、凭据、node_modules、.pnpm-store、.next、构建与缓存。全部路径与规则记录在 manifest 中，不备份密钥。恢复时在全新目录解压，不覆盖工作区；删除列表表示原本不存在的文件，不应从 HEAD 补回。
- 实测：原锁文件 `pnpm install --frozen-lockfile --ignore-scripts` 成功，Node 24.18.0 / pnpm 12.4.2。原始 `tsc --noEmit` 失败，引用不存在的 `generated/prisma/client` 并派生隐式 any 错误。
- 静态发现：`postinstall=prisma generate`，schema 和 prisma.config.ts 已删除；`db:seed` 是 Windows 路径且目标 prisma/seed.ts 已删除。原 `prisma generate` 实测先被缓存文件权限阻断，不能声称已运行至缺失 schema 报错。
- 旧链路：布局/页面→server services→repositories→lib/prisma→缺失客户端；认证使用 lib/auth-core 的 JWT、auth_token Cookie 与 onboarding 分流；旧 speaking/coach API 仍活动。新实现退出这些活动入口；不恢复 Prisma 模型、不触及现有数据库与文件服务。
- 原检查命令：dev/build/start/lint，无正式类型、格式、业务测试脚本；src/test 是旧业务试验，不构成新身份行为验收。原应用启动未执行，已知类型失败，不标记通过。

## 依赖与运行时

已阅读实际安装的 Next 16.2.1 包内 installation、layouts-and-pages、route、headers 指南；更新至稳定版 16.4.0 后复核相同指南。使用 Node runtime、异步 headers 与 searchParams，受保护入口实际查询会话，不以 Proxy Cookie 存在判断授权。

Better Auth 1.7.7 的 peerDependencies 接受 Next 16、pg 8、Drizzle 0.45.2+；锁定 Drizzle 0.45.3 / Kit 0.31.11，使用 node-postgres（适配标准 PostgreSQL 与 Neon 的连接串），没有通用 Repository。

官方依据：[Next 集成](https://better-auth.com/docs/integrations/next)、[邮箱密码](https://better-auth.com/docs/authentication/email-password)、[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)。实际行为以锁定包与隔离 PostgreSQL 测试为准。
