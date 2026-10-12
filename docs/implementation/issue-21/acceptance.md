# Issue #21 — 真实邮件接入

2026-10-12。代码与隔离 PostgreSQL 行为测试已完成；真实邮件验收仍阻塞，不能关闭该票或声称实际收信通过。

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

## 未执行与阻塞

当前环境未配置 Resend API key、经核验 Free 套餐、发信身份，也未取得本轮明确授权的收件地址。没有发送任何真实邮件、购买域名、开通账号或变更 DNS。真实收件箱验证与恢复、供应商拒收/退信、生产域名 DNS、部署环境 HTTPS cookie、生产/预览独立数据库和 secret、大陆及海外实际收信时延均未验证。

## 解除阻塞后的验收

1. 维护者在服务端 secret store 配置 RESEND_API_KEY（发信最小权限）、MAIL_FROM、上述开关；本人试发可使用 onboarding@resend.dev 并设置 MAIL_TEST_OWNER，其他名单用户必须先验证自有域名。仅勾选开关不算验证完成。
2. 生产/预览必须各用独立数据库、BETTER_AUTH_SECRET、BETTER_AUTH_URL、测试名单及专用额度；生产 HTTPS，禁止 DEVELOPMENT_MAIL。不要把密钥放进 next.config env 或 NEXT_PUBLIC_*。
3. 明确授权收件人后，通过注册界面发验证邮件，收件人实际打开后验证登录；通过恢复界面收信重置，验证旧密码/会话失效、新密码成功；重用/过期链接失败。记录 UTC 时间、部署环境、供应商邮件 ID、脱敏收件人、收件确认与动作结果，不记录链接令牌/密码/key。
4. 测试服务故障、超时和额度拒绝时中文提示与重试；确认只有用户重试才新发送。API 返回 ID 不能替代收件确认，迟到/退信仍待排查。

协议依据：[Resend send-email](https://resend.com/docs/api-reference/emails/send-email)（2026-10-12 核对）；套餐与账号前提以已确认 [#17 决策](../../research/2026-10-11-real-services-decision.md) 为准。没有重新授权付费。

最终验证：4 文件 23 项目标测试通过；`pnpm typecheck` 与变更代码 ESLint 通过。发送头包含发信人、收件人、邮件种类、链接及模板版本的 SHA-256 幂等键；Resend 官方说明保留 24 小时，不将其解释为永久去重或自动重试授权。依据：[Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)。每次发送前清理超过两分钟的收件人分钟桶；全局日/月计数保留用于用量核对。
