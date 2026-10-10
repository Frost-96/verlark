# Verlark · 先听后用

中文英语交流应用。目前实现基础页面、测试名单注册、邮箱验证、登录退出、密码恢复与会话撤销；材料与练习尚未实现，真实邮件和语音服务尚未接入。

## 安装与启动

使用 Node.js 24、pnpm 12.4.2。依赖版本与锁文件一同提交。

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# 编辑 .env.local，使用全新的应用数据库与随机认证密钥
pnpm db:migrate
pnpm dev
```

迁移脚本读取 `.env.local` 与 `.env`，显式传入的环境变量优先。应用与迁移统一读取 **`DATABASE_URL`**。测试使用独立数据库，不要将应用数据库用作测试库。数据库使用 PostgreSQL（开发可用本机 PostgreSQL 17；部署目标为 Neon，填写其带 TLS 的连接串）。迁移只新增版本，不会清空数据库。生产使用 Node runtime；正式部署与 Neon 网络尚待后续实测。

无需数据库可执行安装、类型检查、构建，并打开基础首页；认证入口在配置缺失或连接失败时明确失败，不生成虚假会话。启动生产构建使用 `pnpm build && pnpm start`。

## 环境与邮件

- `DATABASE_URL`：新应用数据库连接串。
- `BETTER_AUTH_URL`：应用 origin，例如 `http://localhost:3000`；正式环境须 HTTPS。
- `BETTER_AUTH_SECRET`：至少 32 字符的随机密钥，可用 `openssl rand -base64 32` 生成。
- `TESTER_EMAILS`：逗号分隔的允许邮箱，大小写不敏感；移出名单的账号不能继续取得应用身份。
- `DEVELOPMENT_MAIL=true`：只允许开发/测试；将邮件写入 `.dev-mail/*.json`，文件权限 0600。不发送到真实邮箱，不提供公开收件箱路由；由本机开发者打开文件中的链接。

开发邮件包含登录相关令牌，不提交、不公开分享。在生产中启用替身会被拒绝。替身关闭而真实邮件尚未接入时，投递明确失败，不回退为假成功。

邮箱验证有效期 **60 分钟**：Better Auth 签名 JWT，加 SHA-256 摘要的数据库原子消费记录；并发或重复点击只接受一次。若消费后服务中断，重新发送验证邮件恢复。密码重置有效期 **30 分钟**，由 Better Auth 的数据库单次消费机制处理；重置成功撤销该账号全部旧会话。会话最长 7 天，Cookie 会话缓存关闭，受保护入口每次从数据库校验。当前退出和退出所有设备都在服务端撤销会话，不只删除浏览器 Cookie。

## 数据与检查

```sh
pnpm db:generate      # schema 变更时生成可审查 SQL；不是运行迁移
pnpm db:migrate       # 应用版本化迁移，不执行 seed 或清空
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

表定义归 `src/modules/identity/schema.ts`，`src/db/schema.ts` 仅汇总迁移。Better Auth 管理密码和会话，不存在旧 JWT/onboarding 认证入口。`learning-content` 与 `practice` 仅保留公开类型入口；未来功能票再交付其真实操作和表，不提供伪数据或占位业务流程。

业务测试沿已确认的 identity 公开接口进行，必须显式提供独立 PostgreSQL 测试库，库名以 `_test` 结尾，不能与开发库相同：

```sh
TEST_DATABASE_URL='postgresql://…/verlark_test' pnpm test
TEST_DATABASE_URL='postgresql://…/verlark_test' pnpm db:verify
E2E_DATABASE_URL='postgresql://…/verlark_browser_test' pnpm test:e2e
```

`db:verify` 要求 CREATE DATABASE 权限：创建两个随机命名的空测试库，验证迁移、重复迁移、读写与重建，仅清理本次新建的两个库，不清空传入的测试库。`pnpm test` 在指定库迁移并保留随机测试用户；不执行 TRUNCATE 或 DROP。

浏览器验证需要 `pnpm exec playwright install chromium`，自动启动 3100 端口的开发服务器，使用单独 E2E 测试库、开发邮箱与每次新名单；不能复用不明来源的运行中服务器。桌面和移动视口不等同于真实手机设备验收。测试未使用真实邮件服务。

## 恢复与实施记录

实施前快照位于本机 `.local-snapshots/before-issues-2-6/`（未提交），包含 `workspace.tar.gz`、带文件摘要和删除状态的 `manifest.json` 以及独立恢复验证结果。包含实施前未提交文件与未跟踪文档，排除环境密钥、机器认证配置、依赖缓存和构建产物。

恢复时在新的空目录解压档案，对照 manifest 验证 SHA-256 和删除路径缺失，不在当前工作区直接覆盖。旧 Prisma schema 的删除状态保留，不从 HEAD 恢复，不销毁远端数据库或云端文件。将快照长期保存时需单独备份整个 `.local-snapshots/before-issues-2-6` 目录。

详细证据、已验证范围与限制见 [实施记录](docs/implementation/2026-10-08-foundation.md)。领域与后续阶段见 [首版规格](https://github.com/Frost-96/verlark/issues/1)。

## 聆听练习（#7）

先执行 `pnpm db:migrate`，再执行 `pnpm content:publish`，最后 `pnpm dev`。可通过 `pnpm content:publish content/某材料.json` 发布其他经过检查的材料版本；规则与首份材料说明见 [content/README.md](content/README.md)。

名单用户完成邮箱验证并登录后，进入 `/materials` 选择材料，进入 `/practice/<id>` 播放、重听及按需查看帮助，在 `/practices` 查看并继续同一次练习。刷新或关闭页面不会结束练习；播放器位置及帮助展开状态不承诺恢复。录音提交和表达反馈由后续票据交付。

材料文本、任务、释义、提示和稳定音频路径发布后保存在数据库，同一版本不可改写。开发音频随 `public/audio` 部署；真实存储和保留策略仍待后续决定。浏览器测试只向独立 E2E_DATABASE_URL 迁移并发布开发材料，不使用应用数据库。
