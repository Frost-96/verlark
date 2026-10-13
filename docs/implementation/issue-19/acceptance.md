# Issue #19 实施与验收

2026-10-13（Asia/Shanghai）。**代码实现已交付；整票真实环境验收未完成，不据此关闭 #19。** 基线为 #18 已合并的 `9d0746f`，分支 `implement/issue-19-transcription`，未合入 #20/#21 的独立实施。

## 实现

- 北京百炼 `qwen-audio-3.0-asr-flash` 同步 HTTP Adapter：明确固定模型，验证北京 workspace 主机（兼容北京旧主机），请求真实录音 base64，英文 language_hints，读取 `output.text`、顶层/嵌套 request ID、`usage.duration`。单次请求、45 秒截止；不传虚假的幂等键，不自动重发，不返回固定识别结果。正式环境仍禁止开发替身。
- #18 已有不可变私有录音、真实字节解码校验及 120 秒/8 MiB 限制，继续复用，不新增音频转码。识别检查 WebM/MP4/Ogg/WAV 和 **base64 自身 10 MB** 上限（源文件最多 7,500,000 字节）；超出时在发送前返回中文失败，保留作答。存储允许的 8 MiB 不代表全都可交给同步 ASR。
- 实际服务 90 秒处理权，读取录音后再次检查处理权；请求路由最大执行时间配置 120 秒（平台实际允许性尚未部署验证）。过期、删除、旧请求不得写回或复活作答。应用的接收幂等不保证供应商不会重复计费。
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

## 尚未执行／不能宣称通过

- 真人自愿录音、iPhone/iPad Safari、Android Chrome、Windows/Firefox/Safari 设备矩阵与麦克风权限/中断/锁屏恢复；移动 viewport 不替代手机。
- 真实部署中的上传→接收→ASR→核对→确认全链路；现有探针绕过网站业务写入。
- 选定 Vercel 环境的 120 秒函数预算、90 秒 lease、定时器故障后恢复、跨区域时延/质量与自动维护告警实测。
- 静音的真实 no-content 行为、真实供应商超时/中断/幂等和重试费用对账，以及至少 20 段质量样本。结构测试不能代表识别质量。
- 最终免费额度有效期与控制台扣减/账单审计。当前实现可失败关闭，但没有承诺供应商零保留或全账户零账单。

这些是 #19 的验收门槛，不以代码合并或测试通过替代；父 Issue #1 未作完成声明。

## 最终本地检查

- `TEST_DATABASE_URL=…/verlark_issue19_test pnpm test`：25 个测试文件、156 项通过（包含新的迁移、真实 PostgreSQL 与进程恢复）。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`：通过。构建使用本地正常依赖安装，无 production 配置或真实调用。
- `E2E_DATABASE_URL=…/verlark_issue19_e2e_test pnpm exec playwright test tests/e2e/transcription.spec.ts tests/e2e/recording.spec.ts`：8 项通过，40.8 秒；桌面及移动 viewport，开发录音/识别替身，不能作为实机或生产语音验收。
- `pnpm format:check` 初次报告新增 migration metadata 及基线已有 `drizzle/meta/0012_snapshot.json` 格式问题；本票改动的 metadata 已格式化，未修改既有 0012 快照。全库格式命令仍受该基线文件影响，不声明通过；本票改动文件格式与 `git diff --check` 通过。
- e2e 自动写回的旧票截图已还原，不把它纳入 #19 证据。
