# Issue #21 — 真实邮件接入

2026-10-12。代码、隔离 PostgreSQL 行为测试与本人邮箱的本机真实收信流程已完成；部署环境验收仍未执行，#21 保持 OPEN。

## 实现

- Resend REST `POST /emails`，仅服务端密钥，10 秒截止、不自动重试、不跟随跳转。只有成功 HTTP 响应及非空邮件 ID 才接受。API 接收不等于收件箱投递成功，界面明确说明。
- `MAIL_ENABLED=true` 与 `MAIL_FREE_PLAN_CONFIRMED=true` 才启用；缺凭据、混用开发替身失败关闭。不配置则保留不可用 Adapter，绝不回退到开发 outbox。
- 未验证域名时只允许名单中的 `MAIL_TEST_OWNER`；验证域名后仍限定 TESTER_EMAILS。正式发信地址不能使用 resend.dev 冒充已验证域名。声明开关是维护者核验结果，不代替实际供应商验证。
- 数据库迁移 `0013_mail_send_budget.sql`：全局 UTC 日 90 封／月 2700 封、每收件人每 UTC 分钟 1 封。数据库事务原子预留跨实例生效。发送失败和超时保留预留；不自动退款额度、不自动重发。计数只保存收件邮箱摘要和时间桶，不保存链接或凭据。
- 限额是应用保守限制，不保证账户其他应用零支出；需使用专用免费账号/项目并核对控制台 Free 套餐及余额。分钟桶边界允许相邻两分钟各一次；不宣称滑动60秒节流。
- 显式同源 POST 与回调校验；链接固定指向 BETTER_AUTH_URL。原有令牌过期、一次使用、数据库并发消费和重置撤销会话继续生效。

## 已执行

测试 seam：公开身份 HTTP、真实独立 PostgreSQL、外部邮件 Adapter。依赖已由任务授权。新增 Adapter 测试先红后绿；真实数据库双实例额度并发测试先红后绿；来源回归暴露了外部来源在测试配置被接收，已修复并转绿。

`TEST_DATABASE_URL=<isolated .../verlark_issue21_test> pnpm exec vitest run src/integrations/mail src/modules/identity/identity.test.ts`：覆盖 Resend 协议接收、拒绝/未知结果、名单/来源边界、配额并发与未知结果不释放、注册/重发/恢复失败不虚报成功、过期/重用/并发令牌、账号之间不可串用、注销和撤销所有会话。

## 初始阻塞（后续本机验收见文末）

当前环境未配置 Resend API key、经核验 Free 套餐及发信身份。用户已明确授权本人收件邮箱用于验证与重置测试（地址不写入公开证据）。没有发送任何真实邮件、购买域名、开通账号或变更 DNS。真实收件箱验证与恢复、供应商拒收/退信、生产域名 DNS、部署环境 HTTPS cookie、生产/预览独立数据库和 secret、大陆及海外实际收信时延均未验证。

## 解除阻塞后的验收

1. 维护者在服务端 secret store 配置 RESEND_API_KEY（发信最小权限）、MAIL_FROM、上述开关；本人试发可使用 onboarding@resend.dev 并设置 MAIL_TEST_OWNER，其他名单用户必须先验证自有域名。仅勾选开关不算验证完成。
2. 生产/预览必须各用独立数据库、BETTER_AUTH_SECRET、BETTER_AUTH_URL、测试名单及专用额度；生产 HTTPS，禁止 DEVELOPMENT_MAIL。不要把密钥放进 next.config env 或 NEXT_PUBLIC_*。
3. 明确授权收件人后，通过注册界面发验证邮件，收件人实际打开后验证登录；通过恢复界面收信重置，验证旧密码/会话失效、新密码成功；重用/过期链接失败。记录 UTC 时间、部署环境、供应商邮件 ID、脱敏收件人、收件确认与动作结果，不记录链接令牌/密码/key。
4. 测试服务故障、超时和额度拒绝时中文提示与重试；确认只有用户重试才新发送。API 返回 ID 不能替代收件确认，迟到/退信仍待排查。

协议依据：[Resend send-email](https://resend.com/docs/api-reference/emails/send-email)（2026-10-12 核对）；套餐与账号前提以已确认 [#17 决策](../../research/2026-10-11-real-services-decision.md) 为准。没有重新授权付费。

最终验证：4 文件 23 项目标测试通过；`pnpm typecheck` 与变更代码 ESLint 通过。发送头包含发信人、收件人、邮件种类、链接及模板版本的 SHA-256 幂等键；Resend 官方说明保留 24 小时，不将其解释为永久去重或自动重试授权。依据：[Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)。每次发送前清理超过两分钟的收件人分钟桶；全局日/月计数保留用于用量核对。


## 审查修正

身份 HTTP 来源策略和邮件失败的 503 映射移至 `app/api/auth/http.ts`；identity 模块只传播投递未确认错误。既有来源、回调和失败回归继续通过。Resend 接收 ID 当前不写入本地投递日志，实际验收须按脱敏收件人和发送时间在供应商控制台查找 ID，再人工记录；本实现不宣称已有自动退信追踪。

## 2026-10-12 本人真实邮件验证（进行中）

用户完成本机配置向导，配置了仅服务端使用的 Resend key，并确认 Free 套餐及账号本人邮箱。使用 `onboarding@resend.dev`，未验证自有发信域名；未购买域名或启用付费套餐。本次只在独立本地数据库 `verlark_issue21_live_test` 和 `http://localhost:3101` 开启真实邮件，未改生产配置。

- 2026-10-12 17:07:23（Asia/Shanghai）通过真实网站 `POST /api/auth/sign-up/email` 请求一次本人验证邮件；HTTP 200，真实 Resend Adapter 已核验供应商成功响应及非空 ID，无自动重发。
- 用户确认已经收到邮件，并表示邮箱验证成功。但随后对本次测试账号执行真实登录仍返回 `403 EMAIL_NOT_VERIFIED`，本机测试服务器尚未记录验证链接访问。两者不一致，已请求用户核对最新应用验证邮件是否指向 `localhost:3101/verify-email`；不能仅凭前述口头确认标记应用验证通过。
- 因验证状态未通过，尚未发送密码恢复邮件，也未标记真实重置或会话撤销通过。已有自动化回归证据不替代此次真实验收。
- 最小本机运行状态保存在被 Git 忽略的 `.local-snapshots/issue21-live/`；包含测试密码与会话，不提交、不贴入公开记录。收件地址和 API key 未写入本文。供应商邮件 ID 尚未从控制台补录。

当前已证实真实服务接收请求、用户报告实际收件；验证后登录、真实密码恢复、其他名单收件人、自有域名及部署环境仍未验收。#21 保持 OPEN。

### 本机验证状态更新

用户随后确认第一次在手机打开本机链接；改为当前电脑打开后验证成功。服务端复核登录 HTTP 200 且 `emailVerified=true`，真实收信、点击确认与验证后登录现已通过。此前的 `EMAIL_NOT_VERIFIED` 为较早观测，不再代表当前状态。

电脑上另一个 `/verify-email` 页面没有令牌，原界面仍提示点击按钮但按钮禁用。已改为明确提示链接不完整、从最新邮件打开完整链接，并提供登录页重新申请入口。针对缺失令牌与带令牌入口的 Playwright 回归在桌面和移动 Chromium 视口先失败、修复后 2/2 通过；这不代表手机可访问电脑的 localhost。

已向同一授权本人邮箱发送一次真实密码恢复请求（HTTP 200），等待用户实际收件、重置和新密码登录，再复核旧密码及旧会话失效。#21 仍保持 OPEN；供应商 ID、自有域名与部署环境验收仍待补齐。


### 密码恢复验收完成

用户在收到恢复操作指引后确认“验证完了”。本次记录区分用户确认与服务端证据：

- 用户确认完成本机恢复流程；没有向聊天提供新密码或令牌。
- 使用重置前密码登录返回 `401 INVALID_EMAIL_OR_PASSWORD`。
- 使用重置前保存的会话访问账号页，响应中的流式跳转指向 `/login`，不显示已验证邮箱账号内容；数据库中该旧会话记录为 0。
- 数据库存在恢复请求之后创建的新登录会话，与用户完成新密码登录的确认一致。
- 初次探针使用未开放的 `/api/auth/get-session` 得到 404，不将其作为撤销证据；账号页 HTTP 200 是流式响应，不将其误判为已登录。上述跳转和数据库证据才是最终核对依据。

本机真实验证邮件、恢复邮件及账号操作闭环已通过。未执行的部署环境 HTTPS、来源/环境隔离验收以及供应商 ID 补录仍明确保留；不因本机通过而关闭 #21。没有新增真实邮件发送。


### 供应商回执补录与云端检查

2026-10-12 通过 Resend 控制台邮件列表核对：

| 邮件 | Resend ID | 供应商状态 |
| --- | --- | --- |
| 首封验证 | `01a12f5d-e746-78a2-b07b-6ab0f6d66a3b` | Delivered |
| 用户要求重发的验证 | `01a12f62-df85-745a-b143-2631df2143c5` | Delivered |
| 密码恢复 | `01a12f69-c979-7b50-b8b6-b7ddfca1eb27` | Delivered |

投递状态与用户实际收件和操作确认分别记录；未复制邮件正文、令牌或收件地址。

Vercel 已自动部署提交 `7abf274`（GitHub deployment `7010707967`，Preview success）。HTTPS 首页可访问，账号页报“暂时无法完成操作”。Vercel 控制台显示数据库和身份必需配置仅在 Production，Preview 无独立数据库/身份配置，未发现 Resend 配置。Neon 当前仅 dev 分支。此结果仅证明云端配置门槛未满足，不是部署验收通过。

拟使用 Neon `issue21-mail-preview`，仅复制结构、一天自动删除；仅给 Vercel 当前集成 Git 分支配置 Preview 变量和独立认证密钥。确认凭据云端托管范围前，不创建分支、不上传本机 Resend key、不复用生产数据库。反馈额度和生产部署不随本次邮件验收变更。

### 专用 Preview 环境已配置

用户确认后，2026-10-12 17:45（Asia/Shanghai）创建 Neon Free 分支 `issue21-mail-preview`（`br-restless-dew-azyddyv6`），只复制结构，不复制现有用户数据，设置 2026-10-13 17:45 自动删除。为避免结构复制后没有迁移记录，在该临时分支内新建空库 `issue21_mail_test` 并完成全部迁移；未修改父分支数据。

Vercel 已保存 17 项 Secret，作用域仅 `Preview / integrate/issues-20-21`：独立数据库和 BETTER_AUTH_SECRET、固定 HTTPS 分支回调地址、本人名单及 Resend 配置；全部开发替身、真实反馈、录音与上传关闭。Production 配置未改。稳定入口为 `https://verlark-git-integrate-issues-20-21-p396500554-3359s-projects.vercel.app`。等待此配置后的新部署，再执行云端账号验收；暂不标记通过。
