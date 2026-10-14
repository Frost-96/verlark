# QQ SMTP 实施与配置

2026-10-14（Asia/Shanghai）。用户已确认“先改用 QQ SMTP”，替代 #17 最初 Resend Free 的本轮选择。仍不购买域名、不升级付费服务；其他服务决策不变。#21 必须等 QQ 实际收信及部署验收完成再关闭。

## 已实现

- `MAIL_PROVIDER=qq-smtp` 显式选择；省略保留旧 Resend 配置兼容，未知值失败关闭。不自动切换供应商。
- 固定 `smtp.qq.com:465`，立即 TLS，证书校验开启。QQ 账号须为普通 `@qq.com` 地址，MAIL_FROM 必须一致；授权码仅服务端持有。不开日志、不读取附件或远程内容。
- 单封单收件人，名单和本站验证/恢复链接检查在连接前执行。模板与 Resend 共用，身份令牌、密码及会话逻辑不变，无数据库迁移。
- DNS、连接、问候和空闲超时各设 10 秒；这不是整个发送过程 10 秒总截止。请求等待发送结束，非池化连接，没有后台队列或自动重试。
- 仅当 SMTP 返回最终 250 且唯一目标地址被接受、没有拒绝地址时视作服务接收；不等于进入收件箱。认证失败、超时和拒绝均转换为统一错误，不暴露服务器原文、授权码或链接。
- 复用数据库原子限流：90/UTC日、2700/UTC月、同一收件人每UTC分钟一次；QQ 使用独立 `qq-smtp` 计数范围，失败不返还预留。上述是应用上限，不是已确认的 QQ 账号配额。QQ 不承诺 Resend 的24小时幂等去重能力。

## 本机配置（用户操作）

1. 在浏览器打开 https://mail.qq.com/ 并登录准备发信的 QQ 邮箱。
2. 在设置中寻找“账号”或“账号与安全”下的 POP3/IMAP/SMTP 服务，开启包含 SMTP 的服务，按页面要求完成手机等身份验证并生成授权码。不同版本入口名称可能不同；找不到时提供所在页面名称，不要提供验证码或授权码。
3. 编辑项目根目录 `.env.local` 中的以下配置。授权码是专用授权码，不是 QQ 密码；不要填写到聊天、命令行参数或 `NEXT_PUBLIC_` 变量中。

```dotenv
MAIL_PROVIDER=qq-smtp
QQ_SMTP_USER=你的完整QQ邮箱地址
QQ_SMTP_AUTH_CODE=你生成的授权码
MAIL_FROM=同一个QQ邮箱地址
DEVELOPMENT_MAIL=false
MAIL_ENABLED=false
```

本机的非敏感配置可预先写好；保持 MAIL_ENABLED=false，待授权码配置完后再启动隔离验收。TESTER_EMAILS 保留已有名单并加入用户提供的 Gmail，不覆盖原有其他成员。不要复制整个 `.env.example` 覆盖已有数据库、认证密钥及其他服务配置。

4. 保存后回复“本机授权码已配置”。后续先校验配置（不输出密钥），使用隔离数据库和固定回调站点启动测试，再启用真实邮件验收。

## 部署与剩余验收

- 本机 `.env.local` 不会上传 Vercel。后续须在 Vercel 项目 Environment Variables 中配置相同 QQ 变量，仅限本次集成分支的 Preview；QQ_SMTP_AUTH_CODE 作为敏感值托管。Production 不随测试启用。
- 先核实/恢复原临时 Neon 验收库，保持独立数据库及认证密钥，配置正确 HTTPS 回调地址，关闭开发替身和真实反馈。更新环境变量后必须重新部署。
- 真实 QQ → Gmail 验证、登录、恢复和旧会话撤销；无效/过期/已消费令牌；应用层非法来源与外部回调拒绝；失败和限流行为。旧 Resend Delivered 回执不能替代 QQ 实际投递。
- 尚未登录 QQ SMTP、发送真实邮件、上传 QQ 授权码或验证云端连通性；具体 QQ 账号配额也未确认。未知结果不自动重发。

官方依据：[腾讯授权码说明](https://cloud.tencent.com/document/product/1270/55456)、[Nodemailer SMTP](https://nodemailer.com/smtp)、[Vercel SMTP](https://vercel.com/kb/guide/serverless-functions-and-smtp)。

## 本轮验证

- 专用本机测试库：邮件和身份测试5文件32项通过；供应商由测试边界替换，无真实 SMTP 发送。
- `pnpm typecheck`、定向 ESLint、`git diff --check` 通过。
- 默认 Turbopack 构建因本机绑定端口权限报错（提升执行权限后仍相同）；`pnpm exec next build --webpack` 编译、类型检查及页面生成通过。不将 webpack 结果说成 Turbopack 已通过，未改默认构建命令。
- 已创建被 Git 忽略、权限0600的 `.env.local`，填入已知 QQ 发件地址及 Gmail 测试名单，QQ_SMTP_AUTH_CODE 留空，MAIL_ENABLED=false。未变更任何云端环境。

## 2026-10-14 本机真实投递

在既有专用 `verlark_issue21_live_test` 库和 `http://localhost:3102` 执行，不使用生产数据库。初次启动误用 production 配合 HTTP，配置阶段拒绝请求（503，82ms），未进入邮件发送；随后改用开发运行模式、关闭所有替身。

- 14:37:17 注册请求HTTP 200，耗时3642ms，QQ SMTP Adapter确认最终250与唯一收件人接受。用户确认 Gmail 实际收到邮件并在当前电脑打开验证链接；后端登录复核200、emailVerified=true。
- 14:40:34 恢复请求HTTP 200；用户确认 Gmail收到恢复邮件、重置成功并能登录。
- 14:48:50 重置前密码登录401 INVALID_EMAIL_OR_PASSWORD，重置前cookie访问受保护接口401。旧会话失效。
- 原 Neon Preview 分支已不存在于分支列表，旧凭据连接返回28P01。新建 `issue21-qq-preview`（br-super-hall-azr9zede）仅复制结构，一天自动删除，控制台到期2026-10-15 14:43:31（Asia/Shanghai）。新分支所有表0行后重建结构并执行完整迁移；未触及dev/生产数据。云端收信与来源验收仍待部署。
