# #24 剩余旧代码与依赖清理

日期：2026-10-15（Asia/Shanghai）。实现基线 `ab6ac3d`，集成分支 `integrate/issue-24`，实现分支 `implement/issue-24-cleanup`。前置 #22 已关闭；本票只落实清理，不代表 #23 内容试用或整个首版完成。

## 引用复核与变更

- 活动 `src/`、`scripts/` 与配置已没有旧写作、独立 Coach、自由对话、onboarding、订阅、语言偏好或切换实现；不重新删除不存在的路由。现有身份浏览器测试继续验证旧语音／Coach API 返回 404。
- 逐项检查 import、别名与字符串引用后，删除没有任何活动调用方的 20 个 `src/components/ui/` 组件，以及仅由它们使用的 `src/lib/utils.ts`、`components.json`。当前页面和模块 UI 不使用这组旧组件，仍在使用的模块组件全部保留。
- 删除八个无调用方的直接依赖：`class-variance-authority`、`clsx`、`date-fns`、`lucide-react`、`radix-ui`、`react-day-picker`、`tailwind-merge`、`tw-animate-css`；移除未使用的动画 CSS 导入。删除无引用的五个 Next 模板 SVG，保留实际开发材料音频。
- 锁文件应用 package inventory 从 736 减为 653（83 个移除）；没有新增版本，保留的 653 个 package 元数据／integrity 完全相同。pnpm 重排部分条目，未升级其他依赖。
- 没有 Prisma Client、Prisma CLI、Supabase 客户端、旧认证或旧 seed。身份使用 `better-auth/adapters/drizzle`。锁文件仍有 Better Auth 自带的 `@better-auth/prisma-adapter` 和可选 peer 声明，这是上游包图，不是应用选择 Prisma；不篡改上游包或恢复 Prisma 引擎。
- 删除十个已不可用于新模型的旧 QA 执行器／辅助文件；清单、历史检索提交和行为替代入口见 [QA 索引](../../../qa/README.md)。冻结 baseline、合成语音 fixture、只读离线 comparator、新测试、领域文档、ADR 全部保留。
- README 改为当前启动、服务门槛、测试与维护说明，移除“真实服务尚未实现”等过期断言。两个 Drizzle metadata JSON 原有格式问题仅作 Prettier 空白调整；JSON 结构和 SQL 未改变。

本轮仅为删除无引用实现和修订说明，不引入新业务行为。已读取 TDD 技能；沿已确认的身份／内容／练习公开接口、Adapter 与浏览器 seams 运行现有回归，不添加耦合删除清单或文件布局的测试。

## 已执行验证

在全新 managed worktree 执行依赖安装，移除该 worktree 的 `node_modules` 后重新执行 `pnpm install --frozen-lockfile`。测试使用本次新建的本机 `postgres:17` 容器 `verlark-issue24-db`，绑定 `127.0.0.1:55448`，单元与浏览器分别使用独立 `_test` 库。不读取原工作区 `.env.local`，不连接远端数据库或真实供应商。

| 检查                       | 结果                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| 干净锁文件安装             | 通过，Node 24.18.0 / pnpm 12.4.2                                                      |
| `pnpm typecheck`           | 通过                                                                                  |
| `pnpm format:check`        | 首轮发现两个基线 metadata JSON 格式问题；空白规范化后通过                             |
| `pnpm lint`                | 通过                                                                                  |
| `pnpm build`               | 默认 Turbopack 构建通过，包含类型与页面生成；未改用 webpack 替代                      |
| `pnpm db:verify`           | 两个随机独立空库：全量迁移、重复迁移、读写与重建通过；脚本清理本次随机库              |
| `pnpm test`                | 31 文件、204 项全部通过                                                               |
| `pnpm test:e2e`            | 34 项全部通过（desktop + mobile，2.1 分钟）；包括身份、完整学习流程、隔离、并发和恢复 |
| 离线历史 comparator 自对比 | 无新增失败、无漏跑；保留原有 8 项已知失败，不将其标为新版失败或新版通过               |
| 快照／证据保护             | `qa/baseline`、ADR、词汇表无改动；本机原工作区快照未读取、修改或删除                  |

原始本机执行日志位于 `/tmp/verlark-issue24-{clean-install,typecheck,format,lint,build,db,tests,e2e,comparison}.log`；临时日志不是长期验收存储，本页记录稳定结论。

## 未执行与边界

- 本轮不重复真实邮件发送、云端部署、ASR／反馈供应商调用、真实设备或大陆／海外验证；没有变更这些 Adapter 的行为，沿用对应验收票的证据，不把本地替身结果充作真实服务验证。
- 不执行新的材料制作、人工试听、用户试用或学习效果判断；这些属于 #23。
- 没有删除、迁移或改写旧远端数据库、存储文件、密钥，也没有读取生产环境秘密。历史源码可从 Git 基线检索，本机快照需由维护者另行长期备份。

浏览器套件会重写旧实施目录的截图；本轮执行后恢复这些历史 PNG 的原始 Git 字节，避免覆盖冻结证据。专用测试容器验证结束后移除，不影响其他本机数据库。

## 集成分支并行更新

清理提交 `f5d0c1b` 完成上述全套检查后，按流程合入集成分支新提交 `e82820d`（真实反馈暂停时的提示文案修正），合并提交 `b905f3f`。该并行变更完整保留，不计入本票清理 diff。合并后重新运行完整 `pnpm test`（31 文件／204 项通过）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`，全部通过。干净安装、空库验证、构建及 34 项浏览器结果对应合并前清理提交，未声称对合并后的全部组合重新执行；新增文案分支不改变本票的删除范围。
