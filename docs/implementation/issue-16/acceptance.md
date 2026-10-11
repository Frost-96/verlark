# #16：一份材料贯穿完整流程的组合验收

日期：2026-10-11（Asia/Shanghai）。基线：`2f09e2373f45429e0e2cd3ff8dba6ef01a5846e1`。规格：[#16](https://github.com/Frost-96/verlark/issues/16)、[首版规格](../../first-release-spec.md)。本次增加组合验收，不改业务规则或供应商选择。

## 环境与证据边界

- macOS / Darwin arm64；Node 24.18.0、pnpm 12.4.2、Next.js 16.4.0、Playwright 1.64.0；依赖由 `pnpm-lock.yaml` 锁定。
- 新建独立 PostgreSQL 17 容器 `verlark-issue16-db`，本机端口 55446；模块库 `verlark_issue16_final_test`、浏览器库 `verlark_issue16_browser_test`，无生产库连接。模块通过真实 PostgreSQL 事务、约束及公开接口运行；进程退出与迟到写回测试也使用此数据库。
- Chromium 桌面 1280×800，移动模拟视口 390×844（触控）；单 worker。录音使用真实浏览器 MediaRecorder 加 Chromium 假麦克风，邮件写本地 `.dev-mail`，文件写本地开发目录，识别和反馈使用显式开发替身。
- A01/A02 的“收取”在此仅指读取开发邮件链接；F01–F03 仅验应用契约、固定质量样例及拒绝非法结果，不证明真实识别、投递或模型质量。音频为开发素材，不作为最终听辨质量证据。
- 新测试先运行真实入口以刻画既有行为。首次 journey 失败是测试误以为“再次作答”之后还需“开始录音”；实际按钮会直接开始采集，修正测试后通过。严格索引类型报错亦已修正。没有把这些测试编写错误记作产品缺陷或伪造 red→green 产品修复。

## 分项执行结果

| 类别 | 实际结果 | 证据／命令 |
| --- | --- | --- |
| 干净安装 | 通过；从基线 git archive 新目录执行冻结锁文件安装。首次离线缺少 fdir 缓存，随后正常在线安装通过 | `pnpm install --frozen-lockfile`；执行原始日志 `/tmp/verlark-issue16/clean-install-online.log`，失败尝试 `/tmp/verlark-issue16/clean-install.log` |
| 实施工作树安装 | 通过，冻结锁文件离线安装 | `pnpm install --frozen-lockfile --offline` |
| 类型 | 通过（含两个新测试） | `pnpm typecheck` |
| 格式 | 通过（含两个新测试） | `pnpm format:check` |
| lint | 通过（含两个新测试） | `pnpm lint` |
| 构建 | 基线生产构建通过；本票仅改验收测试、Playwright 配置和文档，无运行时代码变化 | `pnpm build`；`/tmp/verlark-issue16/baseline-build.log` |
| 数据库 | 通过；两个独立空库迁移、重复迁移及持久化验证 | `pnpm db:verify`（独立 final 测试库）；不以生成迁移 SQL 代替执行 |
| 模块及 Adapter | 13 文件、93 测试通过；真实数据库的权限、并发、唯一约束、版本、失效处理权与删除约束 | `TEST_DATABASE_URL=... pnpm test`；`/tmp/verlark-issue16/baseline-tests.log` |
| 新组合浏览器 | 4/4 通过（两场景 × 两视口） | `E2E_DATABASE_URL=... pnpm test:e2e journey.spec.ts isolation.spec.ts`；`/tmp/verlark-issue16/new-browser.log` |
| 全量浏览器 | 32/32 通过，2.0 分钟（16 场景 × 两视口） | `E2E_DATABASE_URL=... pnpm test:e2e`；[保留的逐场景结果](browser-results.txt)；原始 `/tmp/verlark-issue16/full-browser.log` |
| 真实服务／设备／部署 | 未执行，属于第三阶段待决接入 | 见下方未验收清单 |

临时原始日志用于本次执行审计，不保证长期存在；仓库内的本记录、测试源码及下方截图保留验收结论与可复现步骤。历史功能票截图因重跑产生的漂移不纳入本次变更。

## 逐项场景映射

以下 M 为 `src/modules/` 下的模块测试，B 为 `tests/e2e/` 下的浏览器测试；路径均从仓库根解析。每项采用上面的相同真实数据库／替身环境。状态“通过”仅限基础与第二阶段适用范围，不向真实服务外推。

| 场景 | 实际可观察结果 | 证据 | 状态 |
| --- | --- | --- | --- |
| A01 | 名单内注册验证登录；未验证、匿名、名单外拒绝 | M `identity/identity.test.ts`；B `identity.spec.ts`、`journey.spec.ts` | 通过（邮件替身） |
| A02 | 恢复重置可完成；无效、过期及已消费令牌拒绝；并发仅一次成功 | M `identity/identity.test.ts`；B `identity.spec.ts`；邮箱验证 3600 秒，密码重置 1800 秒（`identity/server.ts`） | 通过（邮件替身） |
| A03 | 退出／全设备撤销后重放旧会话不能访问；另一账号会话保留 | M `identity/identity.test.ts`；B `identity.spec.ts` | 通过 |
| A04 | 两个真实账号覆盖下表全部已交付读写；拒绝后 B 的详情、A 的详情及 B 的删除凭据不变 | B `isolation.spec.ts`；M `practice/practice.test.ts`、`identity/identity.test.ts` | 通过 |
| C01 | 选材料播放，初始原文隐藏，重听、中文释义、分级帮助，表达自身情况任务 | B `listening.spec.ts`、`journey.spec.ts` | 通过（开发音频） |
| C02 | 目录用新版，历史重练用原版，旧任务与作答反馈保留，新练习独立 | M `practice/repeat.test.ts`；B `repeat.spec.ts` | 通过 |
| C03 | 旧版撤下后仍读历史，原版重练拒绝；仅发布新版不撤下旧版 | 同 C02 | 通过 |
| C04 | 发布后移除旧内容源文件仍能读持久化文字、任务、释义、提示 | M `learning-content/content.test.ts`、`practice/practice.test.ts` | 通过（音频最终保留另验） |
| P01 | 草稿试听／丢弃／重录不计次；提交接收才计次，失败不删作答 | M `practice/practice.test.ts`、`practice/transcription.test.ts`；B `recording.spec.ts` | 通过 |
| P02 | 并发同标识同内容只一条；响应丢失查询／重发不新增；换内容冲突 | M `practice/practice.test.ts`；B `recording.spec.ts`、`another-attempt.spec.ts` | 通过 |
| P03 | 识别及反馈失败可重试，保持原作答及确认版本；错误和恢复动作中文 | M `practice/transcription.test.ts`、`practice/feedback.test.ts`；B 同名 specs | 通过（故障替身） |
| P04 | 原文、原始转写、确认文本分开；未确认不能生成有效反馈，核对不计新作答 | M `practice/transcription.test.ts`、`practice/feedback.test.ts`；B `journey.spec.ts` | 通过 |
| P05 | V2 更正使 V1 反馈成为历史；V2 重新反馈才恢复当前有效性 | M `practice/feedback.test.ts`；B `revisions.spec.ts`、`journey.spec.ts` | 通过 |
| P06 | V1 迟到反馈不覆盖 V2，不成为 V2 当前反馈或满足结束条件 | M `practice/feedback.test.ts`（过期处理权／迟到结果） | 通过 |
| P07 | 新录音新标识为第二次作答；第一作答及反馈完整保留 | M `practice/another-attempt.test.ts`；B `another-attempt.spec.ts`、`journey.spec.ts` | 通过 |
| P08 | 接收后关闭页面，再从历史继续同一练习；草稿离开有丢失提示 | B `journey.spec.ts`、`recording.spec.ts`、`listening.spec.ts` | 通过 |
| P09 | 无有效反馈或处理中拒绝结束；有效与失败／未核对混合可结束，状态保真 | M `practice/finish.test.ts`；B `finish.spec.ts`、`journey.spec.ts` | 通过 |
| P10 | 唯一反馈更正失效后不能结束；另一次有效反馈或零纠错反馈可结束 | M `practice/finish.test.ts`；B `finish.spec.ts`、`journey.spec.ts` | 通过 |
| P11 | 并发结束与提交／识别／反馈／更正只有合法串行结果；结束后拒绝写入 | M `practice/finish.test.ts`；B `finish.spec.ts` | 通过 |
| P12 | 历史重练新建记录，原记录只读且可删除，重练内容与原版本相同 | M `practice/repeat.test.ts`；B `repeat.spec.ts`、`journey.spec.ts` | 通过 |
| P13 | 实际 worker 进程退出／超时后按恢复入口解锁，显示结果未知；旧处理权不能写回 | M `practice/transcription.test.ts`、`practice/feedback.test.ts`、`practice/finish.test.ts`；B `transcription.spec.ts`、`feedback.spec.ts` | 通过 |
| P14 | 并发重试只能一份有效处理权接受结果，旧结果不覆盖；读取持久化状态断言 | M `practice/transcription.test.ts`、`practice/feedback.test.ts` | 通过 |
| P15 | 公开删除后记录不可读；迟到识别／反馈／提交不复活；部分清理失败及恢复保真 | M `practice/deletion.test.ts`；B `deletion.spec.ts`、`journey.spec.ts` | 通过（开发文件，最终规则另验） |
| F01 | 确认后生成，中文说明英文引用，零至两项问题，可选替代不冒充错误 | M `practice/feedback.test.ts`；`src/integrations/expression-feedback/` 测试；B `feedback.spec.ts` | 通过（固定样例） |
| F02 | 反馈标明文字依据，禁止发音／语调／停顿／综合分数；结束不写已掌握 | 同 F01；B `finish.spec.ts`、`journey.spec.ts` 截图 | 通过（固定样例） |
| F03 | 空白／无内容／非法响应／故障不产生有效反馈，失败有恢复动作 | M `practice/feedback.test.ts`、`practice/transcription.test.ts`；B `feedback.spec.ts` | 通过（故障替身） |
| U01 | 中文主要流程、空状态、验证错误及恢复提示；英语学习文本保留；两视口不横向溢出 | 全部 B，尤其 `identity.spec.ts`、`recording.spec.ts`、`journey.spec.ts` | 通过（Chromium 模拟视口） |
| R01 | 开发能力可见标识；生产环境拒绝误启用，缺配置不退回固定输出 | `src/server/config.test.ts`、`src/integrations/` 测试；B 显示替身说明 | 通过 |

## A04 完整入口清单

`isolation.spec.ts` 通过真实 Better Auth 会话 A/B 及匿名请求访问 HTTP。每个记录操作用 B 的真实有效 ID，匿名 401，A 404；每次都再读 B 的完整记录、A 的完整记录及 B 的删除凭据断言没有变化。JSON 操作附加 B 的 `userId` 被严格输入校验拒绝，伪造 `x-user-id` 也不能替代会话。不存在的随机 ID 不作为跨账号覆盖证据。

| 入口 | 操作／授权范围 |
| --- | --- |
| GET `/api/practices` | list，仅当前会话；伪造 owner 查询参数／请求头仍只得到 A |
| POST `/api/practices` | start，两账号各建自己的练习；匿名拒绝，伪造 userId 拒绝 |
| GET `/api/practices/:id` | read，包含作答、原始转写、确认版本及反馈 |
| POST `/:id/recordings` | saveRecording，拒绝外人上传 |
| POST `/:id/submissions` | submit，拒绝外人提交 B 的有效文件引用 |
| GET `/:id/submissions?submissionId=...` | findSubmission，拒绝查询 B 的实际提交标识 |
| POST `/:id/attempts/:attemptId/transcription` | recognize（含重试）、recover、confirm 各自验证 |
| POST `/:id/attempts/:attemptId/feedback` | generate（含重试）、recover 各自验证 |
| POST `/:id/finish` | finish |
| POST `/:id/repeat` | repeat |
| DELETE `/:id/deletion` | delete，对仍存在的 B 练习验证 |
| GET `/:id/deletion` | readDeletion，对真实已删除 B 练习凭据验证 |
| POST `/:id/deletion` | retryDeletion，对真实已删除 B 练习凭据验证 |
| 页面 `/practice/:id` | 服务器详情读取，A 打开 B 显示找不到 |
| 页面 `/practices` | list + listDeletions，A 不见 B 详情入口或删除凭据，B 可见自己的 |

另验 A 的练习 ID 配 B 的 attempt，以及 A 的 attempt 配 B 的 confirmation，识别、恢复、确认、反馈均拒绝。`/materials` 无私人记录参数，发布／撤下只由维护 CLI 提供；没有独立私有录音下载 HTTP 入口。身份端点由 `identity.test.ts` 覆盖名单、令牌、伪造身份和会话撤销，不假定由练习路由矩阵取代。

## 复现

1. 从此提交安装依赖：`pnpm install --frozen-lockfile`；Node 24、pnpm 12.4.2。
2. 创建全新独立 PostgreSQL 测试库，名字以 `_test` 结尾；分别配置 `TEST_DATABASE_URL` 与 `E2E_DATABASE_URL`。不要把现有业务数据库用作测试库。测试中只替换外部邮件、文件、识别、反馈。
3. 执行 `pnpm db:verify`（按 README 配独立测试 URL）、`pnpm test`；执行 `pnpm typecheck`、`pnpm format:check`、`pnpm lint`、`pnpm build`。
4. 安装对应 Chromium 后执行 `pnpm test:e2e`。配置自动迁移、发布材料、启用开发替身、生成独立邮箱前缀，并在 localhost:3100 启动测试服务器，不复用已有服务器。新 journey 与 isolation 自动在桌面／手机视口执行。
5. `test-results/` 保存本轮输出，journey 保存结束及删除后截图。浏览器 trace 默认关闭，不把不存在的 trace 当证据。

## 未验收项（不记通过）

- 真实邮件投递、语音识别、模型反馈质量、供应商超时／计费：第三阶段尚未选定接入，不以本地替身代替。
- U02：实际手机／电脑麦克风授权、采集、真实识别与反馈；模拟权限故障和假麦克风仅证明 UI 恢复行为。
- R02：中国大陆与海外实际部署、平台执行时长／请求大小／数据库连接恢复链路；本次未部署。
- R03：最终私有文件访问、历史音频保留及删除语义；存储与保留决策尚未完成。本次仅证明开发文件清理及业务记录不复活。
- R04：首批六类内容检查及真实学习者试用；本次只验一份材料的业务流程。完成练习不证明掌握表达或能力提升。


## 组合流程截图

以下为本轮完整浏览器套件生成的截图，不是设计稿。结束页保留第二次未识别作答；删除后原练习不可访问，独立重练记录仍在，开发文件清理结果可见。

- [桌面结束记录](journey-ended-desktop.png)
- [手机视口结束记录](journey-ended-mobile.png)
- [桌面删除结果](journey-deleted-desktop.png)
- [手机视口删除结果](journey-deleted-mobile.png)

人工目视检查：桌面删除页与手机视口结束页中文层级、按钮和英文依据可读，没有发现横向裁切；父代理亦检查桌面结束页。自动断言同时检查结束及删除页无横向溢出。
