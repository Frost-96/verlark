# 重构前运行基线 · 2026-10-02

**结论：当前项目能构建、启动并连接真实数据库，核心业务流程可运行，但尚不是全绿基线。** 默认自动检查共 94 项，86 项通过、8 项失败。失败已记录为重构前缺陷；不能把它们归因于之后的 TanStack Start / Hono 迁移。

本报告基于实际运行、数据库断言、浏览器操作和源码定位。严重级别和修复顺序是评估意见；未完成的外部验证单独列出。全面检查能够扩大已知覆盖范围，不能证明项目不存在其他缺陷，也不能排除之后的数据库或供应商波动。

## 冻结范围与运行环境

- 工作目录：`.`；分支 `master`；HEAD `43da4c85fc88eca630cdc738916941b869b9f3bb`。
- 工作区在检查前已有大量未提交修改。因此基线对应**当前工作区内容**，不是单独的 HEAD。检查前保存了 230 个已跟踪文件的 SHA-256；检查后这些文件没有变化，见 [source-manifest.json](source-manifest.json) 与 [summary.json](summary.json)。
- Node `v24.18.0`、Next.js `16.2.1`、Prisma `7.6.0`；使用当前已安装依赖和生产构建检查。没有重新证明全新机器上的依赖安装流程。
- 本次只新增 `qa/` 检查工具和记录，未修改原有业务代码、环境文件、依赖版本或数据库结构，没有运行 seed / migration。
- 正常应用使用 `127.0.0.1:3000`；模拟应用使用 `3001`、本地供应商使用 `4318`。模拟服务仅覆盖子进程配置，仍连接真实数据库。

## 工程、数据库与页面检查

| 检查 | 实际结果 | 解释与证据 |
|---|---|---|
| 生产构建 | 通过 | 构建退出码 0，24/24 页面生成完成；[build.log](build.log) |
| 构建后启动 | 通过 | 首页和登录页返回 200；匿名 dashboard 返回 307 登录跳转 |
| 独立 TypeScript 检查 | 失败，3 处 | `src/test/test.ts:10` 导入不存在的 `signIn` / `signOut`；`:290` 参数数量不匹配；[typecheck.log](typecheck.log) |
| 源码与配置 ESLint | 失败，6 errors / 7 warnings | sidebar 与 speaking-session 的 React Hooks 问题、旧测试文件的 `any` 等；[lint-results.json](lint-results.json) |
| 新增 QA 脚本 ESLint | 通过 | 与业务代码 lint 分开验证 |
| Prisma schema validate | 通过 | schema 可解析 |
| 真实数据库读写 | 通过 | 8 张应用表可读；注册、资料、练习、消息、评分保存与删除操作实际落库 |
| 表字段核对 | 通过 | Prisma 的 100 个标量字段与数据库字段存在性、类型、可空性和 varchar 长度核对通过；[dependency-results.json](dependency-results.json) 第一项 |
| 迁移记录 | 5 条全部已完成 | 全部校验和在 LF / CRLF 标准化后匹配；[migration-checksums.json](migration-checksums.json) |
| 完整 schema drift 检查 | 未完成 | Prisma migrate diff 经当前 pooler 超时，未取得完整索引、约束、默认值等差异结论；[schema-diff.json](schema-diff.json) |
| 数据库稳定性 | 出现间歇性异常 | 见下文，不能概括为始终稳定 |
| `db:seed` 可移植性 | 发现现有配置问题 | `package.json:12`、`prisma.config.ts:10` 硬编码 Windows 路径和不存在的 `jiti@2.6.1` 目录；未实际执行 seed |

构建通过与独立类型检查失败并不矛盾：当前安装的 Next 构建类型检查会过滤测试文件诊断，独立 `tsc` 会包含这些文件。重构验收需要同时保留两类检查。

数据库检查期间观察到认证协议错误、Prisma `P2028` 事务开始超时、连接意外中断；浏览器曾进入错误边界，重试恢复。后续连续 6 次受保护页面读取全部通过，见 [stability-results.json](stability-results.json)。**原因尚未定位**，网络、连接池和应用连接管理均不能仅凭这些现象排除。

迁移校验最初只处理了一种换行转换方向，历史 `dependency-results.json` 曾报告 3 条不匹配；后续逐条计算 LF 和 CRLF 后全部匹配。本报告以修正后的独立记录为准，不把换行差异列为数据库结构缺陷。

## 默认自动检查集合

| 集合 | 通过 / 总数 | 覆盖 |
|---|---:|---|
| [core-results.json](core-results.json) | 60 / 62 | 公开与受保护页面、匿名 API、输入验证、注册登录、引导、资料、语言、草稿、基础跨账号隔离、退出 |
| [mock-results.json](mock-results.json) | 13 / 14 | Coach 与 Speaking 流式/非流式处理、消息持久化、TTS、音频存储签名、错误回滚、写作与口语评分 |
| [speech-adapter-results.json](speech-adapter-results.json) | 7 / 8 | STT SDK 请求与结果映射、Azure 评分字段、FFmpeg 转换、发音结果保存、无身份拒绝 |
| [operation-results.json](operation-results.json) | 5 / 6 | 重命名、练习软删除、跨账号删除拒绝、账号删除与旧会话 |
| [regression-results.json](regression-results.json) | 1 / 4 | 404、匿名调试接口、写作字数、口语练习时长 |
| **合计** | **86 / 94** | 不包含历史真实供应商尝试、浏览器人工操作或工程检查 |

通过项使用真实 HTTP / Server Actions、登录 Cookie 和数据库；外部供应商按下面的边界模拟。请求失败时不仅检查状态码，也检查适用的消息回滚、练习状态和数据库结果。

## 8 项已复现的既有问题

P1 表示建议在迁移前优先修复的权限问题；P2 表示其他行为或数据一致性问题。这是本次风险排序，不代表完整安全审计。

| 编号 | 优先级 | 可复现事实与影响 | 源码定位 |
|---|---|---|---|
| B01 | P1 | A 账号携带 B 的 `messageId` 提交发音评分，返回 200，B 消息评分被写为模拟值 91。路由只验证已登录，没有校验目标消息所有者。 | `src/app/api/speaking/pronunciation/route.ts:118`、`src/server/services/speaking.service.ts:558` |
| B02 | P1 | 删除 B 账号后，本次响应清除了 Cookie；但重放删除前的 JWT，仍能创建写作练习。软删除没有使已签发会话失效。 | `src/lib/auth.ts:48`、`src/lib/auth-core.ts:49`、`src/server/services/user.service.ts:146` |
| B03 | P2 | 仅提交姓名的资料更新把未传的英语等级和学习目标清空，导致引导资料丢失。完整资料表单载荷保存通过。 | `src/server/services/settings.service.ts:103` |
| B04 | P2 | 写作练习重命名同时覆盖原始题目 `prompt`，后续复习或评分失去原题。 | `src/server/services/writing.service.ts:430` |
| B05 | P2 | 重复提交已评分作文时，先再次调用供应商，再以 HTTP 500 拒绝。测试确认额外产生 1 次供应商请求。 | `src/server/services/writing.service.ts:629`、`:564` |
| B06 | P2 | 新草稿直接提交 64 词作文后，正文和评分已保存，但 `word_count` 仍为 0。先保存草稿再提交的 UI 路径能够保留之前字数，这不能覆盖直接提交或未保存修改的情况。 | `src/server/services/writing.service.ts:549` |
| B07 | P2 | 把本轮空练习的创建时间设为一天前再结束，记录了 86401 秒练习时长。计算使用创建至结束的墙钟时间，会包含离开页面或闲置时间。若产品明确要统计“会话存续时间”，应先修改指标定义；当前把它展示为练习时长会失真。 | `src/server/services/speaking.service.ts:334` |
| B08 | P2 | `/api/speaking/pronunciation-local` 接受匿名请求并进入调试处理，返回 502，而非鉴权拒绝或禁用。未证明该请求成功调用真实语音供应商，也未证明实际泄露本地文件路径。 | `src/app/api/speaking/pronunciation-local/route.ts:7` |

B01 仅对临时 A/B 账号验证，Azure 识别结果由测试替身提供；真实路由处理、服务和数据库写入被执行，请求身份来源替换为 A。其余用户数据没有用于跨账号写入测试。

## 浏览器人工流程

使用浏览器实际点击、输入和刷新；以下为人工验证，不额外计入 94 项：

- 正常实例：示例账号登录后可打开 dashboard、写作历史；随后退出，写操作改用本轮临时账号。
- 写作：创建自定义题目、输入 58 词正文、保存草稿、刷新确认保留、提交并显示模拟评分及反馈，完成。
- Coach：390 × 844 视口下通过导航抽屉进入，发送消息、收到完整流式回复、会话 URL 更新、刷新后消息仍在，完成。
- Speaking：选择酒店场景，键入对话、显示 AI 回复和音频按钮、结束练习、自动生成评估并展示对话记录，完成。
- 移动视口下写作评估和导航抽屉未观察到明显横向溢出。
- 音频签名 URL 和取回字节已自动验证；点击过音频按钮，但没有进行实际听辨验收。麦克风权限、录音采集和真实语音识别效果未验证。

另观察到侧栏状态标签可能在刷新前滞后、已加载草稿仍显示未保存提示，尚未做独立稳定复现，不计入上表 8 项。浏览器曾出现数据库错误边界及恢复期间的 React 错误，不能报告控制台始终无错误。

## API Key 与外部服务边界

按用户要求，不把大部分现有 API Key 不可用当成迁移阻塞项。默认回归集不调用真实 AI 服务：

- 本地 HTTP 服务提供 OpenAI 兼容 JSON/SSE、TTS 音频和 Supabase Storage 上传、签名、读取、删除协议。模拟有效回复、401、空回复、非法结构、TTS 失败等情况，检查真实应用处理和持久化。
- 腾讯云 STT 和 Azure 发音评分替换 SDK 的外发识别方法；请求映射、SDK 结果解析、真实 FFmpeg 转换及数据库保存仍执行。
- 合成音频由系统语音生成，不是用户录音。浏览器看到的模拟评分和反馈不用于评估 AI 质量。

**已确认的是当前代码能处理这些供应商协议样例；无法仅凭模拟保证“换入任何有效 Key 就一定能用”。** 新 Key 的权限、模型名、地区、配额、网关协议和真实供应商返回仍需要一次真实验收。模拟通过且真实接口认证失败，首先应归入配置/供应商待验证；响应格式或应用处理失败则继续调查代码。

用户澄清之前做过少量真实调用：写作评分成功并保存；Coach / Speaking / TTS 等遇到 401 或 Invalid API Key。STT、Azure 和 Storage 的独立真实验证未完成。历史 [ai-results.json](ai-results.json) 和 [dependency-results.json](dependency-results.json) 保留原始尝试，部分失败来自上游失败导致的缺失前置数据，不能当作互相独立的业务缺陷，也不纳入默认 94 项。

## 其他既有功能边界与未覆盖项

- 忘记密码页目前仅用定时器显示提交成功，没有实际邮件重置流程，见 `src/app/(auth)/forgot-password/page.tsx:26`。
- Google 登录明确为禁用 / Coming soon；本次不认定为一个已完成但运行失败的功能。
- 未验证支付、邮件投递、OAuth、真实音频质量、长时间负载、并发竞争、其他浏览器与设备，以及线上部署。没有执行依赖漏洞扫描或全面渗透测试。
- 数据库字段核对不等同于完整迁移差异检查；间歇性连接故障仍需定位。

## 清理与重构时的使用方式

临时账号与级联业务记录已删除；精确匹配本轮 UUID 的数据库账号数为 0，临时会话文件已移除，见 [cleanup-verification.json](cleanup-verification.json)。模拟服务已停止，内存音频对象随其退出销毁；正常生产实例重新构建后留在 `http://127.0.0.1:3000`，收尾复查首页、登录与匿名跳转通过。

每完成一部分迁移，按 [qa/README.md](../../README.md) 运行工程检查、创建临时数据、执行 5 个默认集合、对比并清理。每轮使用新的结果目录。对比工具区分新增失败、既有失败、修复、缺失用例和失败原因变化；通过对比只说明本轮没有发现新增偏差。

建议先单独修复 B01 / B02，并修复或明确接受其余已知问题，再开始技术栈迁移。保留这份初始证据，修复后另建基线，不覆盖历史失败记录。迁移到 TanStack Start / Hono 后需要替换 Next Server Actions 的测试调用适配层，保留原有行为断言。不要把现有错误行为改成测试的期望结果来获得全绿。
