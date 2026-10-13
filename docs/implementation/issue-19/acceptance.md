# Issue #19 实施与验收

2026-10-13（Asia/Shanghai）。**代码实现已交付；整票真实环境验收未完成，不据此关闭 #19。** 基线为 #18 已合并的 `9d0746f`，分支 `implement/issue-19-transcription`，未合入 #20/#21 的独立实施。

## 实现

- 北京百炼 `qwen-audio-3.0-asr-flash` 同步 HTTP Adapter：明确固定模型，验证北京 workspace 主机（兼容北京旧主机），请求真实录音 base64，英文 language_hints，读取 `output.text`、顶层/嵌套 request ID、`usage.duration`。单次请求、45 秒截止；不传虚假的幂等键，不自动重发，不返回固定识别结果。正式环境仍禁止开发替身。
- #18 已有不可变私有录音、真实字节解码校验及 120 秒/8 MiB 限制，继续复用，不新增音频转码。识别检查 WebM/MP4/Ogg/WAV 和 **base64 自身 10 MB** 上限（源文件最多 7,500,000 字节）；超出时在发送前返回中文失败，保留作答。存储允许的 8 MiB 不代表全都可交给同步 ASR。
- 实际服务 90 秒处理权，读取录音后再次检查处理权；请求路由最大执行时间配置 120 秒，已在下述生产部署的 Vercel Resources 核对；这不等于已运行 120 秒或已完成线上过期恢复演练。过期、删除、旧请求不得写回或复活作答。应用的接收幂等不保证供应商不会重复计费。
- `recognition_call` 独立持久化调用 id、作答关联（删除后置空）、录音摘要指纹、模型、开始/截止时间、请求 ID、状态和用量预留；不存储音频或转写正文。预算按固定模型键使用 PostgreSQL 事务锁跨进程串行预留，每次预留最坏 120 秒。成功且有效用量回执按秒向上取整结算；未发送释放，其他失败/未知保留 120 秒。未知不会被迟到结果或删除释放。
- 用户明确重试会再次占用额度但保留同一作答；服务端对真实服务重试要求 `acceptDuplicateCost`，页面有明确的复选框。预算到期、不足或未核实均拒绝新请求，缺配置不回退开发识别。
- 已有每日 `/api/maintenance/recordings` 执行有界识别恢复（包括删除后独立用量回执），不自动重发供应商请求；只读维护状态报告过期处理积压。学习者仍可主动恢复；维护者可通过 `scripts/recognition-maintenance.ts` 查看/恢复/对账。每日运行不是 90 秒内自动恢复的承诺，部署调度尚未实测。

## 运行配置与恢复

`.env.example` 说明新增配置。`BAILIAN_ASR_ALLOWANCE_SECONDS` 是这个应用持久化账本的累计可支出上限，不是每次重启重新领取的余额。运营者需先核实精确模型、地域、到期时间、用完即停开关和实际余量；扣除其他工具/应用占用后设置上限。调整额度需以供应商实际权益为依据，不能随意重置账本。应用控制不代替供应商账户硬停止，也不是零账单证明。

`DASHSCOPE_API_HOST` 可为账户北京 workspace 主机 `ws-….cn-beijing.maas.aliyuncs.com`，默认旧北京主机 `dashscope.aliyuncs.com`；其他主机拒绝。API key 只在服务端，禁止放入浏览器配置。

```sh
# 读取配置中的业务数据库；仅由有权限的维护者执行，勿当作自动测试命令。
pnpm exec tsx scripts/recognition-maintenance.ts status
pnpm exec tsx scripts/recognition-maintenance.ts recover
# 先恢复已过期状态，并独立核对供应商账单；EVIDENCE_REF 只写不含个人信息的审计引用。
pnpm exec tsx scripts/recognition-maintenance.ts reconcile CALL_ID SECONDS EVIDENCE_REF --billing-verified
```

对账仅允许已过截止时间的 unknown 调用，秒数 0–120；运行中及已结算的不同结果拒绝。命令无识别发送功能。保留未知预留至对账，不将 4xx、无声、网络异常推断为免费。

## 已执行证据

测试 seam 使用既有规格批准的 practice 公开 Interface、隔离真实 PostgreSQL、外部 HTTP/文件 Adapter 边界。实施过程中先看到 provider 协议、持久化预算、维护恢复、配置、对账、删除在途恢复测试失败，再实现并通过。

- 隔离本地 PostgreSQL：新建 `verlark_issue19_test`、`verlark_issue19_e2e_test`，从迁移运行；未使用或清空业务 `DATABASE_URL`。
- 自动化覆盖真实协议形状、空内容、明确失败、HTTP 5xx、请求异常、无效输出、超大/不支持格式预发送拒绝、未知保留预算、显式重试、跨实例预算竞争、过期额度、实际子进程终止恢复、迟到结果、删除在途用量回执及账单对账。
- 使用下述脱敏真实成功回执重建 HTTP envelope，经生产 Adapter、practice Interface 完成转写、核对、确认和重读；此测试的 HTTP 和存储是外部替身，**不是第二次真实调用，也不是网站真实上传全链路验收**。
- 初始 build/e2e 被工作树外 `node_modules` 符号链接触发的 Turbopack root 限制阻断；随后用 `pnpm install --offline --frozen-lockfile`（561 缓存包，零下载）安装本地依赖后重跑。最终检查结果见下方。

### 真实供应商协议探针（父任务执行）

见 [protocol-results.json](protocol-results.json)。用户授权正常不过量测试后执行四次请求：合成英文 WAV、实际 Chromium MediaRecorder 输出 WebM/Opus、MP4/Opus 均 HTTP 200，英文文本与原样本一致，成功回执各报告 2 秒。静音 HTTP 400，脱敏回执不足以判定错误原因与是否计费；保留预留并停止后续调用，没有自动重发。共预留 9 秒，成功响应观测用量 6 秒；这不是账单扣款/免费扣减的证明。探针发生在业务账本之外，其预留记录见证据文件，不混称为应用账本操作。

官方协议依据（2026-10-13 核查）：[同步 HTTP](https://help.aliyun.com/zh/model-studio/fun-asr-flash-recorded-speech-recognition-http-api)、[格式说明](https://help.aliyun.com/zh/model-studio/asr-model)。当前页面示例可能是新版模型，代码仍采用已确认的精确 3.0 模型，不随别名迁移。同步接口未取得幂等键或结果查询保证。

### 浏览器媒体证据

见 [browser-results.json](browser-results.json)、[browser-speech-results.json](browser-speech-results.json)。macOS Darwin 27 arm64 上 Headless Chromium 156 的真实 MediaRecorder 对 WebAudio 合成输入生成 WebM/Opus、MP4/Opus；现有解码器验证成功，无新增转换。该浏览器不支持 Ogg 录制。不是真人麦克风、手机、Safari 或网络区域体验测试。音频字节未提交仓库。

## 生产部署与控制台核对快照

本节依据本轮父任务实际部署、控制台与鉴权状态读取记录，新增静音探针由实施子任务执行。时间点必须与版本一起理解，**不代表之后仍是最新生产版本**。

| 已核实事项 | 本轮观测 |
| --- | --- |
| 生产部署 | 2026-10-13 14:59:24（Asia/Shanghai），提交 `b0bc38a`，部署 `dpl_6Fc9DUxaAUjoxvenvsgbBEwXWYkb` 为 Ready，站点 `articu-lab.vercel.app` |
| 数据迁移 | 生产迁移 `0013` 执行成功 |
| 运行配置 | Vercel Resources 显示 transcription 使用 Node.js 24、IAD1，函数执行时间上限 120 秒；维护入口上限 60 秒 |
| 在线只读状态 | 2026-10-13 07:03:29Z（北京时间 15:03:29），鉴权 status 返回 `recognitionRecovery.expired = 0`，应用预算 `committedSeconds = 0`、`remainingSeconds = 360`，截止 `2026-10-14T06:00:00Z`，当时尚未到期 |
| 供应商权益 | 百炼控制台显示精确 ASR 模型免费余额 35,992 / 36,000 秒，到期日期 2027/01/10，「免费额度用完即停」为 ON |

**应用预算与供应商权益不同。** 当前 360 秒是应用持久化账本的累计可支出上限，`2026-10-14T06:00:00Z`（北京时间 10 月 14 日 14:00）是人为设置的提前停止时间，不是供应商赠额到期时间；不能把 360 秒说成账户只剩 360 秒。应用账本中的 0 仅说明当时本账本没有已登记调用，不能证明此前协议探针或其他工具没有消耗供应商用量。控制台余额和停止开关观测不能替代逐次账单对账。

已验证资源配置与在线状态说明代码、迁移和配置能在所选运行环境装配运行。空积压 `expired = 0` 不会执行非空作答恢复，因此不能单独证明线上中断请求的接管、状态恢复和迟到写回拒绝已演练；本地真实 PostgreSQL/进程终止测试仍是独立一层证据。此次只读检查没有触发会同时修改全局媒体清理的维护操作。

### 继续验收后的唯一新增供应商请求

用户明确继续部署与剩余验收后，于 2026-10-13 07:00:32Z 仅新增一次 2 秒合成 PCM 静音请求，使用生产 Adapter 协议和同一精确模型。HTTP 400 的原始响应确为 **2 字节 `{}`**；没有 provider code、request ID、usage 或错误消息。Adapter 返回 `failed`、`dispatched: true`、`reason: provider`，这是明确请求失败，费用仍未知；继续保留本次 2 秒探针预留，没有自动重试。不能从 HTTP 400 推断静音的 `no-content` 语义或零收费。

本地受限证据在 `/tmp/verlark-issue19-deploy/silence-round2.request.json`、`silence-round2.raw.json`、`silence-round2.sanitized.json`；前置预留先于请求落盘。该探针仍在应用业务账本之外，不是网站真实上传→接收→核对链路，也不是真人录音。

## 尚未执行／不能宣称通过

### 原票仍需补齐的验收证据

- 至少真实手机与真实电脑的自愿麦克风录音，贯穿试听、上传、接收、真实识别、核对/更正、确认及刷新后同一作答；记录实际 OS/浏览器版本、格式、大小、时长与恢复观察。现有 headless 合成输入和移动 viewport 不替代实机；U02 的权限拒绝与恢复仍需观察。
- 所选部署环境中的可靠恢复执行证据，特别是非空过期作答的恢复与迟到结果拒绝。已核实 120 秒/60 秒函数资源配置和只读空队列状态；尚不能据此声称定时器失效、中断后接管或恢复实际执行通过。
- 真实录音质量及格式适用范围的记录。现有供应商探针与离线故障测试分别说明协议结果和恢复逻辑，不能合并成真人全链路通过。

原票允许在指定外部 Adapter seam 替换能力，并要求真实隔离 PostgreSQL 验证数据库与并发；已有无内容、超时/中断、明确失败、unknown、重试及迟到写回测试可作为相应故障行为证据。并不要求为撞出每种罕见错误持续发起真实计费请求。真实静音目前只能记为上述 HTTP 400 失败；它没有提供可识别的供应商 `no-content` 语义。供应商同步接口未取得幂等保证，重试另占额度、unknown 留预留与不自动重发的限制继续明确保留。

### 建议扩展与仍未知信息

- 更广泛的 iPhone/iPad、Android、Safari、Windows、Firefox 完整设备矩阵、锁屏/来电、跨区域时延/质量和告警演练属于扩展验证建议，不把每个组合另加为原票硬门槛。真实手机和电脑的必要验收不因此取消。
- 研究报告的「最初建议至少 20 段语音」是质量评估建议，不是 #19 原 issue 的硬性数字门槛；仍需要有意义的真实口语质量观察，不能以固定文本或结构测试替代。
- 逐次控制台扣减/账单对账尚未完成，尤其不能因 4xx 就释放费用未知预留；已核实免费余额、到期日期与用完即停开关，不再将这些写成尚未查看。未承诺供应商零保留或全账户零账单。

#19 仍因真实设备链路与选定环境恢复证据未完备而保持开放；代码合并、资源配置、空队列状态和本地测试不能替代这些行为证据。父 Issue #1 未作完成声明。

## 最终本地检查

- `TEST_DATABASE_URL=…/verlark_issue19_test pnpm test`：25 个测试文件、156 项通过（包含新的迁移、真实 PostgreSQL 与进程恢复）。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`：通过。构建使用本地正常依赖安装，无 production 配置或真实调用。
- `E2E_DATABASE_URL=…/verlark_issue19_e2e_test pnpm exec playwright test tests/e2e/transcription.spec.ts tests/e2e/recording.spec.ts`：8 项通过，40.8 秒；桌面及移动 viewport，开发录音/识别替身，不能作为实机或生产语音验收。
- `pnpm format:check` 初次报告新增 migration metadata 及基线已有 `drizzle/meta/0012_snapshot.json` 格式问题；本票改动的 metadata 已格式化，未修改既有 0012 快照。全库格式命令仍受该基线文件影响，不声明通过；本票改动文件格式与 `git diff --check` 通过。
- e2e 自动写回的旧票截图已还原，不把它纳入 #19 证据。

## 代码审查修复

2026-10-13，按独立 Standards/Spec 审查在同一 implementer 分支完成：

- 将北京主机白名单收敛为共享纯校验函数，应用配置与 Adapter 两个边界仍各自验证，避免未来不一致。
- 免费额度有效期在取得预算锁并读完累计用量后再次核对；读录音与处理权检查完成后、调用供应商前再检查。模拟读取期间跨过免费到期时间，原测试确实错误地识别成功；修复后不发送、作答失败且预留释放。即使读取也超过 lease，确定未发送仍可释放预留，但过期作答不能写回；这与“远端是否已执行未知”的保留规则区分。
- 非 2xx 响应与成功响应共用有界 256 KB 读取，仅提取格式受限的顶层/`output`/`error` 内 request ID。HTTP 400/403/502 保留未知用量预留，不保存或显示原始错误正文，不推断免费；超大、无效正文及恶意日志字符不进入用量回执。
- 供应商回执晚于 lease 或恢复时，只补充缺失的 request ID 供对账；不会释放 unknown 预留、覆盖已完成的账单对账或接纳迟到转写。公开 Interface 回归测试覆盖尚未对账和已对账两个分支。
- 所有修复均未增加真实供应商调用；实机、正式部署和真实网站全链路门槛保持开放。

审查修复后的最终重跑：隔离 PostgreSQL 上 `pnpm test` 为 25 文件、163 项通过（13.65 秒）；`pnpm typecheck`、`pnpm lint`、`pnpm build`、本票修改文件 Prettier 与 `git diff --check` 均通过。此次变动未改 UI，未重复此前已通过的 8 项浏览器回归；全库格式检查的既有 0012 快照限制仍按上文报告。
