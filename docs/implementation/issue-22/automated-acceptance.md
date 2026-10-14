# #22 本机自动验收

2026-10-14（Asia/Shanghai）。被测代码为 `integrate/issue-22` 的 `9fe0926`；实施分支 `work/issue-22-baseline` 从该提交建立，祖先检查通过。本记录只报告自动化证据，不替代真实部署、服务质量或设备验收。

用户本轮将设备／地区范围缩至当前电脑，暂不验证中国大陆；手机仍未实测。真实服务有限验收由独立记录报告，本次自动化没有调用百炼、Blob 或真实邮件，也没有修改云端配置及旧预算账本。

## 环境与隔离

- 当前电脑：macOS arm64；Node.js 24.18.0、pnpm 12.4.2、Next.js 16.4.0、Playwright 1.64.0、Chromium 156.0.8078.4。
- 新建本机 PostgreSQL 数据库 `verlark_issue22_automated_test` 与 `verlark_issue22_browser_test`，分别用于模块测试和浏览器回归。没有清空或重用既有服务试验库；验收完成后已回收本次新建的这两个数据库。
- 测试命令以 `env -i` 清除继承环境，只保留 HOME、PATH 和对应的测试数据库地址。Playwright 自己显式开启四类开发替身和伪麦克风，不加载任何真实服务凭据。
- 依赖最初链接主工作区，静态检查和 webpack 构建成功；浏览器启动被 Turbopack 的跨文件系统根软链接限制拒绝。随后移除该软链接，以 `pnpm install --offline --frozen-lockfile` 在本 worktree 安装锁定依赖成功，原始 Playwright 配置可启动。该首次启动失败是隔离环境问题，未修改应用或测试来绕过行为断言。

## 已执行

| 检查 | 结果与范围 |
| --- | --- |
| `pnpm typecheck` | 通过，包含 Next.js 路由类型生成及 TypeScript 检查 |
| `pnpm lint` | 通过，完整仓库配置范围 |
| `pnpm format:check` | 通过，完整仓库配置范围 |
| `pnpm exec next build --webpack` | 通过，本机生产编译、类型检查、静态页面生成和路由追踪 |
| `pnpm test` | 31 个文件、197 个测试全部通过；真实隔离 PostgreSQL，外部服务为测试替身 |
| `pnpm db:verify` | 两个额外新空库迁移、重复执行、持久化读写与重建通过，脚本随后删除这两个验证库 |
| `pnpm test:e2e` | 34 项全部通过（desktop 17、mobile 模拟视口 17），耗时 2.2 分钟；无未解释行为失败 |
| 生产配置探针 | 内存合成配置逐一开启 DEVELOPMENT_MAIL、DEVELOPMENT_RECORDINGS、DEVELOPMENT_TRANSCRIPTION、DEVELOPMENT_FEEDBACK，四者均被拒绝；未开启真实识别／反馈时保持关闭 |

已有模块测试覆盖未配置识别／反馈时不回退固定结果、邮件失败不返回假成功、免费预算及 unknown 预留、超时恢复与迟到结果拒绝、删除及回放授权、材料版本、并发结束与提交等行为。生产配置探针通过公开 `readConfig` 接口执行，不连接服务；这证明当前代码的配置约束，不证明部署平台实际变量正确。

浏览器回归覆盖注册验证与密码恢复、会话撤销、跨账号所有 HTTP 操作、播放与分级提示、录音试听／丢弃／重录、提交响应丢失与并行草稿恢复、识别／反馈中断后的手动恢复、更正后旧反馈依据、再次作答、结束只读、原版本重练与撤下提示、删除结果核对。完整运行回执见 [browser-regression.txt](browser-regression.txt)。旧票截图由测试重新生成后恢复为原版，避免覆盖历史证据。

## 验收场景与证据映射

编号对应 [首版规格的验收场景](../../first-release-spec.md#验收场景)。下表引用的测试均属于上文已通过的 197 项模块测试或 34 项浏览器回归；“通过”限定为自动化覆盖部分，不将含真实服务条件的整个场景标记完成。路径以仓库根目录为起点，`practice/*` 表示 `src/modules/practice/*`，`e2e/*` 表示 `tests/e2e/*`。

| 场景 | 已通过的测试文件／探针 | 本次覆盖与边界 |
| --- | --- | --- |
| A01、A02 | `src/modules/identity/identity.test.ts`、`e2e/identity.spec.ts` | 名单、注册验证、密码重置、无效／过期／重复令牌及投递失败不假成功；邮件捕获替身，不证明真实收信 |
| A03 | `src/modules/identity/identity.test.ts`、`e2e/identity.spec.ts` | 退出、撤销和密码重置后原会话失效，跨账号撤销隔离 |
| A04 | `practice/practice.test.ts`、`e2e/isolation.spec.ts` | 用真实本机会话验证受保护 HTTP 读写、嵌套标识及删除回执隔离；外部服务仍为替身 |
| C01 | `e2e/listening.spec.ts` | 本地开发材料播放、原文默认隐藏、中文释义及分级提示；不证明首批真实材料质量 |
| C02、C03 | `practice/repeat.test.ts`、`e2e/repeat.spec.ts` | 目录新版、历史原版独立重练、撤下提示及禁止自动换版 |
| C04 | `src/modules/learning-content/content.test.ts`、`practice/practice.test.ts` | 更换内容实例／移除源文件后仍读取持久化历史；真实材料音频保留另验 |
| P01、P02、P08 | `practice/practice.test.ts`、`e2e/recording.spec.ts`、`e2e/recording-recovery.spec.ts`、`e2e/journey.spec.ts` | 草稿与正式作答、幂等／冲突、响应丢失恢复及离开继续；伪麦克风 |
| P03、P04 | `practice/transcription.test.ts`、`practice/feedback.test.ts`、`e2e/transcription.spec.ts`、`e2e/feedback.spec.ts` | 原作答重试、转写／确认文本区分、未确认不生成反馈及可操作失败恢复 |
| P05、P06 | `practice/feedback.test.ts`、`e2e/revisions.spec.ts` | 更正保留旧依据、旧反馈失去当前有效性、迟到结果不覆盖新版本；外部延迟为受控替身 |
| P07 | `practice/another-attempt.test.ts`、`e2e/another-attempt.spec.ts` | 新录音形成第二次作答，旧文本与反馈保留 |
| P09、P10、P11、P12 | `practice/finish.test.ts`、`practice/repeat.test.ts`、`e2e/finish.spec.ts`、`e2e/repeat.spec.ts` | 当前有效反馈及处理中条件、零纠错、失败作答保留、并发结束写入、结束只读及独立重练 |
| P13、P14 | `practice/transcription.test.ts`、`practice/feedback.test.ts`、`src/integrations/expression-feedback/bailian.test.ts`、`e2e/transcription.spec.ts`、`e2e/feedback.spec.ts` | 本机进程终止／超时恢复、并发处理权、迟到拒绝及 unknown 预算保留；未在 Vercel 注入故障或核验供应商实际计费 |
| P15 | `practice/deletion.test.ts`、`practice/audio.test.ts`、`e2e/deletion.spec.ts` | 删除即时拒绝、迟到不复活、清理失败／未知与重试；文件故障使用替身，不证明远端物理清理或 48 小时目标 |
| F01、F02、F03 | `practice/feedback.test.ts`、`src/integrations/expression-feedback/bailian.test.ts`、`e2e/feedback.spec.ts`、`e2e/finish.spec.ts` | 文本依据、结构／零纠错样例、失败不伪造结果及界面文案；只覆盖固定／回放样例与业务约束，F01/F02 实际生成质量另验 |
| U01 | `e2e/identity.spec.ts`、`e2e/listening.spec.ts`、`e2e/journey.spec.ts` 及失败恢复回归 | 中文主要流程在 desktop/mobile 视口通过；不是实际手机或全浏览器文案审计 |
| R01 | `src/server/config.test.ts`、`src/integrations/transcription/transcription.test.ts`、`src/integrations/expression-feedback/feedback.test.ts`、生产配置探针及上述浏览器回归 | 显式替身与生产拒绝、缺失配置不回退；实际部署变量需独立核验 |
| U02、R02、R03 | 本记录没有完成这些场景的真实条件；R03 的部分业务防线由 `practice/audio.test.ts`、`practice/deletion.test.ts`、`practice/practice.test.ts` 覆盖 | U02 实机全真实链路、R02 大陆／海外访问、R03 真实 Blob／云端恢复仍不能由本机自动化宣布通过 |

本次审查修订只补充编号映射，未改代码或测试，不重复执行已通过且未变更的测试。

## 未执行与结论边界

- 本记录未执行真实麦克风录音、真实识别／反馈／邮件、Vercel 上传及函数运行、真实私有对象删除或故障注入。生产包中 Linux FFmpeg 能否执行、实际函数预算、请求大小和真实数据库连接需部署证据；本机 webpack 成功不能代替。
- 手机实机、Safari、其他浏览器、中国大陆／海外分别接入尚无本记录证据。自动化 mobile 项目只是 390×844 触屏视口，不能记作手机通过；当前电脑也不自动代表已验证某地区网络。
- 自动化固定反馈只证明业务行为，不证明生成质量、语音识别准确率或学习效果。
- 上述自动验收及证据映射没有修改业务代码或添加测试。后续小幅修正账号页过时文案（`bd1469d`），Standards／Spec审查均为0项发现；另已合入最小安全ASR诊断（`79169cf`），相关实现与测试证据见[诊断记录](asr-diagnostics.md)。该源码的Production重建已Ready，部署信息见[真实验收记录](live-acceptance.md)；本记录中的原自动化结果对应前述被测提交。真实ASR的`unknown`仍待独立诊断，不以自动化通过排除产品或集成缺陷。
- 本记录本身不足以关闭 #22 或宣称第三阶段／首版全部通过，仍需结合真实链路记录及剩余未验收项。
