# 重构前验证基线

冻结结果：[2026-10-02 检查报告](baseline/2026-10-02/REPORT.md)。原有业务代码未被这些检查修改。`qa/` 内是检查脚本、模拟供应商、合成音频和结果；没有新增依赖。

这些测试检查期望行为，不把已知缺陷改写成“正确行为”。因此当前基线本来就有失败用例。对比脚本区分新增失败、已知失败、修复和漏跑；“没有新增失败”不代表所有功能已经正常。

## 每次重构一部分后的执行顺序

在项目根目录运行。先停止占用旧构建的应用实例，再构建；不要一边重建 `.next` 一边使用旧实例。

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node node_modules/eslint/bin/eslint.js src prisma next.config.ts prisma.config.ts eslint.config.mjs qa
node node_modules/prisma/build/index.js validate
RAYON_NUM_THREADS=4 node node_modules/next/dist/bin/next build
```

类型检查和 lint 的当前失败详见冻结报告。为避免现有 pnpm 自动安装行为干扰基线，示例直接运行已安装的本地工具。请先按锁文件安装依赖。

在两个终端分别启动正常应用和隔离的模拟环境：

```sh
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

```sh
node qa/mock-environment.mjs
```

模拟环境在 `127.0.0.1:4318` 提供 OpenAI 兼容 LLM/TTS 和 Supabase Storage 协议，在 `127.0.0.1:3001` 运行同一份生产构建。它只覆盖子进程环境变量，**不修改 `.env`**；真实数据库仍来自项目配置。该实例的真实腾讯云和 Azure 密钥被置空，避免误调用。不要把模拟服务部署或公开到网络。

随后在第三个终端执行。每条命令独立运行；已知失败返回非零时仍需要运行后续项，收集完整结果。

```sh
export BASELINE_OUTPUT="qa/runs/$(date +%Y%m%d-%H%M%S)"
node qa/check-baseline.mjs --keep-fixtures
BASELINE_URL=http://127.0.0.1:3001 node qa/check-mock-baseline.mjs
node qa/check-speech-adapters.mjs
node qa/check-regressions.mjs
node qa/check-operations.mjs
node qa/compare-baseline.mjs qa/baseline/2026-10-02 "$BASELINE_OUTPUT"
node qa/check-baseline.mjs --cleanup
```

每轮使用新的结果目录，避免旧结果掩盖漏跑。`check-operations` 会删除本轮 B 测试账号，必须放在需要两个有效账号的检查之后。完成后停止模拟服务；其内存中的音频对象会随进程退出消失。

## 数据边界与清理

- 核心脚本通过真实注册 action 创建两个带 UUID 标记的测试账号，执行引导、资料、草稿等写操作。不会运行 `db seed`、数据库迁移或修改已有用户。
- 身份与 fixture ID 暂存在权限为 `0600` 的 `/tmp/verlark-baseline-fixtures.json`，结果文件不保存 JWT、API Key 或密码。
- 核心脚本默认自动清理；上述组合检查使用 `--keep-fixtures`，最后必须执行 `--cleanup`。异常中断后也执行该清理命令，再开始下一轮。
- 清理只匹配本轮 UUID、账号 ID 和邮箱；关联练习通过数据库外键级联删除。可选真实 AI 检查记录的音频路径也只在测试账号前缀下清理。
- `synthetic-speech.mp3` 是用系统语音合成生成的测试句子，不是用户录音。

## 覆盖层次

| 脚本 | 边界 |
|---|---|
| `check-baseline.mjs` | 真实 HTTP、Next Server Actions、登录 Cookie、真实 PostgreSQL；不调用 AI |
| `check-mock-baseline.mjs` | 真实应用路由、SSE、TTS 队列、数据库保存；外部 LLM/TTS/Storage 用本机 HTTP 模拟 |
| `check-speech-adapters.mjs` | 真实 STT/发音路由、FFmpeg、数据库保存；只替换 SDK 的外发识别方法和请求身份来源 |
| `check-regressions.mjs` | 已发现的字数、练习时长、匿名调试接口与 404 边界 |
| `check-operations.mjs` | 重命名、软删除、删除后旧会话行为 |
| `compare-baseline.mjs` | 比较测试名称和状态；缺失检查不会算通过 |

模拟通过说明应用能处理这些供应商协议样例，不能证明某个真实密钥的权限、模型、配额、地区或实际语音识别效果。真实麦克风采集、浏览器授权及听辨质量需要单独人工验收。

更换技术栈后，HTTP API 的行为断言可以继续使用；`baseline-lib.mjs` 的 `action()` 当前读取 Next 的构建清单，迁移到 TanStack Start/Hono 时需要替换这层调用适配。不要因为旧 action 消失而删除它覆盖的注册、草稿、删除等行为断言。

## 可选的真实供应商验收

本次用户要求不以失效 API Key 阻塞代码检查。默认流程不运行以下脚本；只有需要验证新密钥、且明确愿意调用真实供应商时再使用：

```sh
node qa/check-ai-baseline.mjs
node qa/check-dependencies.mjs
```

这两项使用当前环境并产生真实 API 请求，应在核心 fixture 创建后、删除检查之前执行；它们不属于默认 94 项对比集合。依赖缺失造成的下游未执行不能解释为独立代码缺陷，详情以报告的覆盖边界为准。
