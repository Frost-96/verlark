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

## 数据与身份实现（#4–#6）

- 数据源在本轮实施时使用专用变量；2026-10-09 按用户要求统一改为 `DATABASE_URL`，应用、迁移与测试隔离检查同步更新。测试显式使用独立 `TEST_DATABASE_URL` / `E2E_DATABASE_URL`，库名以 `_test` 结尾；不清空指定库。
- 本次创建本机 `postgres:17-alpine` 隔离容器 `verlark-identity-test-20261008`，仅绑定 127.0.0.1:55432。模块测试库 `verlark_test`，浏览器测试库 `verlark_browser_test`；未连接旧数据库与云端存储。
- 认证由 Better Auth 管理；公开身份返回仅包含学习者 id、邮箱、称呼。请求中的 userId 不决定访问身份；数据库会话、邮箱验证和当前测试名单共同决定访问资格。
- 身份表、会话、凭据、验证及单次邮箱验证记录由版本化 SQL 创建。练习、作答、材料等表未提前实现。
- 邮箱验证 3600 秒。Better Auth JWT 默认重复点击仍返回成功，经 RED 用例实测后增加 SHA-256 摘要消费记录：条件 UPDATE 原子竞争，签名仍由 Better Auth 校验。保存 consumedAt 保证旧链接不会因重复投递而重新启用。
- 密码恢复 1800 秒，Better Auth 的 hashed verification identifier 与数据库原子 consumeOne 保证单次消费。重置后撤销全部旧会话；会话最长 7 天、关闭 Cookie 会话缓存。退出当前会话和全部设备均验证旧 Cookie 重放失败。
- 邮件替身仅写入本机权限受限、Git 忽略的 `.dev-mail`；无公开收件箱 API。生产拒绝启用替身。未配置真实邮件及本机投递失败都返回中文失败，不标记为已投递。
- 认证后的页面只显示邮箱资格与内容尚未开放，不显示虚假学习成功。后续两个模块仅保留公开类型入口，没有伪造目录、练习记录或状态实现。

## 审查与修复

按 code-review 技能对基线 `43da4c85fc88eca630cdc738916941b869b9f3bb` 至本次实现分两轴并行审查。

### Standards

初次发现 1 项：identity 内混入路径、HTTP 方法与响应映射，违反已确认架构的请求入口职责。已移到 `src/app/api/auth/http.ts`；identity 保留认证协议封装和身份规则。复查无剩余发现。

### Spec

初次发现 1 项：Better Auth 会捕获邮件 callback 异常，直接让 Adapter 抛错仍可能返回 200。回归用例先实测失败（实际 200、期望 503），随后通过 AsyncLocalStorage 请求级结果传播修复。保护范围覆盖整个验证 callback（凭据写入及投递），密码恢复亦同；不启用后台投递 handler。新增未配置真实邮件及同一实例并发成功／失败隔离用例。复查无剩余发现。

最终剩余：Standards 0；Spec 0。工具测试结果和人工静态审查分别记录，不相互替代。

## 最终验收（2026-10-08，macOS arm64 / Node 24.18.0）

| 项目                  | 实际结果与证据                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 可恢复快照 #2         | 331 文件 SHA-256 一致，10 删除路径保持缺失；独立目录恢复，manifest 与 verification 在本地档案内                                                                                                                                                                                                   |
| 干净安装 #3           | 从实现提交 `git archive` 导出 `/tmp/verlark-clean-issues-2-6`，无 node_modules / .env；`pnpm install --frozen-lockfile` 完整安装通过（包含允许的生命周期），日志 `/tmp/verlark-clean-install.log`                                                                                                 |
| 类型 / lint / 格式 #3 | 最终 `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全部通过；没有关闭类型检查或新增 any                                                                                                                                                                                                      |
| 全套自动测试 #5–#6    | 最终一次完整 `pnpm test`：2 文件、11 用例通过，零跳过。身份用例使用真实 PostgreSQL，邮件/时间为明确测试边界                                                                                                                                                                                       |
| 迁移 / 持久化 #4      | `pnpm db:verify` 在两个随机新建空库执行迁移、重复执行、真实读写、保留数据和从空库重建；全部通过，仅删除本次新建空库                                                                                                                                                                               |
| 浏览器 #5–#6          | 最终 `pnpm test:e2e`：Chromium 桌面 1280×800、移动视口 390×844 两条流程通过，覆盖中文注册、未验证登录拒绝、单次验证、登录退出、旧 Cookie 重放、密码恢复、旧密码拒绝、全部设备撤销、无效/重复链接、旧 API 404；日志 `/tmp/verlark-final-e2e.log`，截图 `test-results/account-{desktop,mobile}.png` |
| 生产构建 #3           | 最终 `pnpm build` 通过，未配置新数据库也可构建；认证页面按请求动态运行。日志 `/tmp/verlark-final-build.log`                                                                                                                                                                                       |
| 生产 HTTP #3          | `pnpm start --hostname 127.0.0.1 --port 3101`：首页及登录 200；旧 writing 与 speaking API 404；未配置认证 POST 返回中文 503                                                                                                                                                                       |
| 审查                  | Standards 与 Spec 各发现一项并完成修复，二次复核均无剩余发现                                                                                                                                                                                                                                      |

中途阻塞与失败如实区分：Turbopack 初次构建被沙箱禁止本机端口阻断，在获准环境重跑后通过；受保护页曾在预渲染时提前初始化配置，已改为请求时执行；浏览器测试曾因换行标题及 Next route announcer 的选择器冲突失败，修正选择器后全流程通过。原依赖锁残留 Prisma 可选 peer 导致安装失败，清理旧解析并显式管理 peer 后，干净冻结安装通过。这些失败没有记为通过，表中为修复后的最终结果。

未执行及边界：真实邮件送达、Neon 远端连接与 Vercel 部署、真实手机设备和大陆/海外网络、材料/练习/语音/反馈均未验收，属于后续票据或已明确延后事项。本阶段开发邮件替身只证明应用行为，不能宣布整个首版可用。测试数据库均为本机新建隔离环境；没有修改旧数据库或销毁云端文件。

工作区中原有但不属于本任务的机器配置、AGENTS.md、CLAUDE.md 删除、技能锁、品牌资源、QA 与设计文档保持原状，未一起提交。快照保留了这些范围内的项目文件，凭据及机器配置按清单排除。

## 2026-10-09 配置名称调整与实际连接验证

按用户要求将应用、迁移、测试隔离检查、浏览器测试和模板统一为 `DATABASE_URL`。使用用户已有连接配置执行增量迁移成功，只读检查确认 5 张身份表均存在；未清空应用数据库。

发现本地缺少认证 origin、测试名单和开发邮件配置，经用户同意使用测试邮箱，在被 Git 忽略的 `.env.local` 中补齐 `BETTER_AUTH_URL=http://localhost:3000`、`TESTER_EMAILS=local-desktop@example.com`、`DEVELOPMENT_MAIL=true`。原有数据库连接与认证密钥未改动。

配置测试 2 项、类型检查、lint、修改文件格式检查通过。使用实际本地开发服务器及用户配置的数据库，复用现有桌面浏览器验收流程，1 项通过（24.3 秒），覆盖注册、未验证禁止登录、邮箱验证及重复链接拒绝、登录、退出及旧 Cookie 失效、密码重置及旧密码拒绝、所有会话撤销。产生一个测试账号，开发邮件仅写入本机文件。未运行完整独立数据库测试套件，也未验证真实邮件或生产部署。

## 2026-10-09 远程同步前复核

基础分支 `integration/foundation-sync` 收录基础实现、DATABASE_URL 调整、领域/架构/规格文档与历史 QA 依据；UI 原型和品牌资源单独保存在 `prototype/listen-then-use-ui`。本机 MCP、编辑器、技能配置及 CLAUDE.md 的本地删除未发布。

- 按锁文件安装通过。最初沙箱网络限制导致 pnpm 自动安装失败，允许网络后恢复成功；没有修改锁文件。
- 类型、lint、格式检查通过。原型分支遗留的 `.next/dev` 生成类型移至临时目录后重跑通过。
- 默认 Turbopack 生产构建通过。
- 新建本机隔离 PostgreSQL 17 容器（127.0.0.1:55441）；11 项测试通过；两个随机空库迁移、重复执行、持久化读写和重建通过。未修改应用数据库。
- 独立浏览器测试库：桌面与手机视口两条认证全流程通过，覆盖注册、验证、登录、恢复、退出与会话重放拒绝。
- Standards 与 Spec 两项独立静态审查均为 0 项剩余发现。

本轮构建、安装和浏览器日志分别保存在本机 `/tmp/verlark-foundation-{build,install,e2e}.log`。快照恢复证据沿用 `.local-snapshots/before-issues-2-6/verification.json`。真实邮件、部署、语音和完整学习流程继续留待后续任务。
