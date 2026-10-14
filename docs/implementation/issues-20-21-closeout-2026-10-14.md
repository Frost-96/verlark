# #20 / #21 关闭前复核

2026-10-14，Asia/Shanghai。继续现有 `integrate/issues-20-21` / PR #37；两张票仍未满足全部关闭条件。

## 本轮已执行

读取 #17、#20、#21 的正文与评论，以及 v6 计划和邮件验收记录。#17 已关闭；PR #37 尚未合并。

通过现有本机 PostgreSQL 容器的专用 `verlark_issues20_21_test` 库运行：

```sh
pnpm exec vitest run src/integrations/expression-feedback src/integrations/mail src/modules/identity/identity.test.ts src/modules/practice/feedback.test.ts
```

结果：8 文件、59 测试全部通过。外部服务由测试边界替换，没有真实供应商调用或邮件发送，没有写入 `verlark_issue20_test` 的真实反馈额度账本。该结果证明当前分支的自动化回归通过，不证明真实反馈语义质量或云端来源边界通过。

## #20 本轮结果：仍不能关闭

用户批准最多22次请求、追加最多200,000 token预留、2小时、零付费、未知即停。授权窗口保守设为 `2026-10-14T05:45:38Z` 至 `2026-10-14T07:45:38Z`。旧账本86条、297,411预留、40,334报告用量（含历史mock）；累计预留上限497,411。

用户完成登录后，执行前核实固定模型免费余额959,949/1,000,000、有效期至2027-01-10，并确认用完即停开启。真实调用共8次：v6兼容探针2次、v7回归6次，无未知结果、无自动重试。新增预留53,607，供应商报告用量15,786；累计94条、351,018预留、56,120报告用量。预留值不是费用，混有历史mock的累计账本也不是供应商账单。

v6将清楚的普通请求误判为no-content。v7仅调整输入分类提示词，明确普通请求和祈使句可以生成反馈；固定模型、结构协议、思考预算及输出预算未改变。v7六例均有结构有效的generated结果，但语义仍失败：例如擅自消除人称歧义，将时间冲突解释为回到过去，以及把my bicycle改成your bicycle并确定借出/借入方向。停止剩余14例，不以结构通过替代质量通过。v7修改前已看过冻结输入，不能声称完全盲测；未在看到这批输出后继续调参或重跑。

脱敏原始结果见 `issue-20/quality-v6-compat.json`、`issue-20/quality-v7-regression.json`；用量及请求回执见 `issue-20/provider-receipts-v6-v7.json`。八条记录输出通过真实隔离数据库的业务回放（8/8，6条接受、2条拒绝），回放无新增供应商调用，不评判语义质量；见 `issue-20/quality-v6-v7-business-replay.json`。修改后自动化回归8文件59测试通过，typecheck及定向ESLint/Prettier通过。

真实反馈继续保持默认禁用，#20开放。不得将本轮未使用次数视为无限期授权。

## #21 剩余步骤

已有本人邮箱的本机及专用 HTTPS Preview 收信、验证、恢复和会话撤销证据。原临时 Neon 分支计划于2026-10-13 17:45到期；本轮未核实实际删除状态，不能把旧入口视作当前可用环境。

部署配置下的非法来源及外部回调仍需取得应用层拒绝证据，不能以平台401或浏览器阻断替代。后续应恢复隔离 Preview 环境后执行不会发信的登录探针，保留访问保护。

既定方案明确本人试发不替代其他名单测试者投递。用户询问其本人其他邮箱是否可用：可以将独立邮箱加入测试名单，验证不同收件地址的投递及账号隔离，但不声称多人使用体验通过。用户已提供其独立 Gmail 地址（不在公开记录中重复个人地址）；尚未确认有可管理DNS的自有发信域名。

本机配置仍为 `onboarding@resend.dev`、`MAIL_DOMAIN_VERIFIED=false`。2026-10-14核对 [Resend官方限制](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)：默认测试域名只允许向Resend账号关联邮箱发送，其他收件地址须先验证自有发信域名。即使另一邮箱属于同一人，也不能绕过此限制。未购买域名、变更DNS、发送新邮件、启用生产服务或缩减验收范围。

已核实 QQ 邮箱可通过 SMTP 和授权码发送邮件，但普通 QQ 邮箱不赋予用户对 qq.com 的 DNS 管理权，不能作为 Resend 自有验证域名。QQ SMTP 是替代发送供应商的可行候选，尚未配置或验收。用户正在比较继续 Resend 与改接 QQ SMTP 的后续操作，尚未确定供应商变更；现有 #17 的 Resend 决策仍保留。官方依据：[腾讯邮件连接器](https://cloud.tencent.com/document/product/1270/55456)、[Resend 域名要求](https://resend.com/docs/dashboard/domains/introduction)。

后续决定：用户已明确批准改用 QQ SMTP，并要求先完成可独立实施的工作。当前邮件选择由上述比较阶段推进到 QQ SMTP 实施，见 `issue-21/qq-smtp.md`；真实 SMTP 授权及收信尚待完成。
