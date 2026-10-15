# Verlark · 先听后用

面向测试名单的中文英语交流应用：选择英语听力材料、聆听和查看帮助、录音并提交作答、核对转写、取得基于确认文本的表达反馈，再次作答、结束、历史重练及整次删除。界面与操作说明使用中文，材料、示例和英语作答保持英文；没有语言偏好或切换入口。

当前采用 Next.js 16、Drizzle、PostgreSQL（部署目标 Neon）及 Better Auth。真实邮件、私有录音、识别与反馈 Adapter 已实现，须显式配置并符合各自的额度与运行门槛；开发替身通过不代表真实服务或设备通过。首版整体交付仍以 [总规格 #1](https://github.com/Frost-96/verlark/issues/1) 与各验收票为准，清理 #24 不能代替内容试用 #23。

## 安装与本机启动

使用 Node.js 24、pnpm 12.4.2，按锁文件安装：

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# 编辑连接串、随机认证密钥、站点 origin 与测试邮箱名单
pnpm db:migrate
pnpm content:publish
pnpm dev
```

仅在首次配置时复制示例，不覆盖已有环境文件。`DATABASE_URL` 必须指向新应用 PostgreSQL 数据库；不要使用旧业务库。迁移脚本优先使用显式环境变量，再读取 `.env.local`、`.env`，只应用版本化迁移，不执行 seed 或清空。`content:publish` 发布随项目提供的开发材料，重复发布相同版本幂等；真实材料另见下文。

`BETTER_AUTH_URL` 是站点 origin（本机 `http://localhost:3000`，生产须 HTTPS）；`BETTER_AUTH_SECRET` 至少 32 字符，可用 `openssl rand -base64 32` 生成。`TESTER_EMAILS` 为逗号分隔邮箱名单。生产构建与启动分别为 `pnpm build`、`pnpm start`；基础构建无需配置数据库，但实际认证与业务访问需要数据库及正确配置。

## 开发替身与真实服务

`.env.example` 是配置字段入口，所有真实服务默认关闭。开发邮件写入私有 `.dev-mail/`，开发录音写入 `.dev-recordings/`；不要提交或公开这些目录。麦克风需要 HTTPS 或 localhost。未提交的音频草稿留在页面内存中，离开可能丢失；已接收作答从数据库恢复。

- `DEVELOPMENT_MAIL=true`：本机文件收件箱，包含验证／恢复令牌；不发送真实邮件。
- `DEVELOPMENT_RECORDINGS=true`：本机私有录音文件，仅用于开发。
- `DEVELOPMENT_TRANSCRIPTION=true`：明确标注的固定测试转写。
- `DEVELOPMENT_FEEDBACK=true`：仅支持界面列出的固定样例，不评价任意文本。

这些替身均禁止在生产环境开启。生产使用 Node runtime、真实 PostgreSQL 和显式配置的服务；缺失配置或服务失败会明确失败，不回退为替身成功。

| 能力           | 当前实现与维护依据                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 邮件           | QQ SMTP 为当前试验选择，Resend 保留为显式可选 Adapter；见 [邮件配置和已执行验收](docs/implementation/issue-21/qq-smtp.md)                                               |
| 录音与材料文件 | Vercel Blob private，上传许可、清理回执与恢复保护；见 [运行维护](docs/implementation/issue-18/operations.md)、[恢复方案](docs/implementation/issue-18/recovery-plan.md) |
| 识别           | 百炼北京，持久化免费额度与 unknown 预留；见 [识别验收](docs/implementation/issue-19/acceptance.md)                                                                      |
| 表达反馈       | 百炼北京固定模型及规则版本，仅基于确认文本；见 [质量边界](docs/implementation/issue-20/quality-v8-max-review.md)                                                        |
| 真实材料       | 离线制作、人工试听审校、不可变版本发布；见 [制作指南](docs/material-audio-preparation.md)、[内容试用记录](docs/implementation/issue-23/content-trial.md)                |

密钥只放在本机私有环境文件或部署平台的服务端环境变量中，不使用 `NEXT_PUBLIC_`。API key 存在不表示获得启用授权、免费权益有效或试用额度充足。不要通过修改 trial ID、重建账本或自动重试绕过额度保护。

## 数据、验证与维护

```sh
pnpm db:generate      # schema 变更时生成可审查 SQL
pnpm db:migrate       # 应用迁移，不清空数据库
pnpm typecheck
pnpm format:check
pnpm lint
pnpm build
```

模块各自维护 `schema.ts`，`src/db/schema.ts` 汇总迁移；身份由 Better Auth 的 Drizzle Adapter 管理。活动代码和脚本没有 Prisma Client、Supabase 或旧自建认证。Better Auth 自带的 Prisma Adapter 仍可能出现在锁文件中，那是上游传递依赖；本项目不导入或配置它，也不安装 Prisma 引擎来维持旧测试。

测试使用独立数据库，库名必须以 `_test` 结尾，不能与应用库相同：

```sh
TEST_DATABASE_URL='postgresql://…/verlark_test' pnpm test
TEST_DATABASE_URL='postgresql://…/verlark_test' pnpm db:verify
pnpm exec playwright install chromium
E2E_DATABASE_URL='postgresql://…/verlark_browser_test' pnpm test:e2e
```

`db:verify` 需要 CREATE DATABASE 权限，创建两个随机空库，验证迁移、重复迁移、读写与重建，然后仅删除本次创建的库。业务测试在指定测试库迁移并保留随机测试用户，不执行 TRUNCATE 或 DROP。浏览器测试启动独立 3100 端口开发服务器，迁移并发布开发材料，使用文件邮件、模拟麦克风和明确的服务替身；不复用来源不明的服务器。桌面／手机视口不能代替真实设备或地区验收。

历史练习固定到内容版本；新版发布不覆盖旧版，撤下不抹掉历史。开发材料命令见 [内容说明](content/README.md)，真实材料必须走审校发布流程。音频清理、维护告警和恢复后删除回放按运行手册执行；只读状态检查不会执行清理或刷新扫描成功时间。

## 证据与恢复

[QA 索引](qa/README.md) 区分当前测试与冻结的旧行为证据。旧写作、Coach、自由对话、onboarding、订阅及双语入口不属于当前应用；旧 QA 执行器已退役，不恢复旧模型或依赖来运行它们。

实施前快照位于原工作区本机 `.local-snapshots/before-issues-2-6/`（未提交，也不自动复制到 Git worktree），包含 `workspace.tar.gz`、摘要 manifest 和恢复验证。长期保存需单独备份该目录。恢复应在新的空目录解压并验证摘要与删除路径，不能直接覆盖当前工作区。详见 [基础恢复记录](docs/implementation/2026-10-08-foundation.md)。

本轮没有删除旧远端数据库、存储文件、密钥或本机快照。领域依据保留在 [词汇表](GLOSSARY.md)、[ADR](docs/adr/) 和 [领域模型](docs/domain-model.md)；清理范围与验证结果见 [#24 验收](docs/implementation/issue-24/acceptance.md)。
