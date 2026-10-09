# 首版认证与部署候选核查

查阅日期：2026-10-07（Asia/Shanghai）。状态：研究建议，未定选型；未部署或安装依赖。

## 结论

Better Auth + Drizzle + Neon 与 Next.js App Router 有官方支持路径；Vercel 可以作为首版部署候选。主要待验证项是实际语音请求大小、每次处理时长、FFmpeg 的生产打包与运行，而非“语音网站必然需要独立 WebSocket 服务器”。登录注册为首版要求；具体邮箱验证、密码重置、OAuth 范围仍应由产品决定。

## 官方事实：Better Auth

- Next.js App Router 可在 `/api/auth/[...all]` 挂载 `toNextJsHandler(auth)` 的 GET/POST；服务端通过传入请求 headers 的 `auth.api.getSession` 读取会话。Server Actions 中设置登录 Cookie 可使用 `nextCookies` 插件，放在插件数组末尾。RSC 本身不能设置 Cookie，因此不能指望在 RSC 读取会话时刷新 Cookie。[Next.js 集成](https://better-auth.com/docs/integrations/next)。
- 当前 Drizzle 适配文档使用独立包 `@better-auth/drizzle-adapter`，支持 PostgreSQL 的 `provider: "pg"`；认证 schema 可由 Better Auth CLI 生成，再由 Drizzle Kit 管理迁移。文档区分 Drizzle Relations v1/v2 的适配入口，实施时必须锁定相容版本，不能混抄旧教程。[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)。
- Drizzle 官方支持 Neon 的 HTTP、WebSocket 和标准 PostgreSQL 驱动。因此“Better Auth → Drizzle PostgreSQL adapter → Neon”是由官方支持能力组合得出的候选方案，并非本项目已经完成的集成。驱动选择还需覆盖业务事务语义。[Drizzle + Neon](https://orm.drizzle.team/docs/connect-neon)。
- Better Auth 提供邮箱密码注册登录；数据库会话方案使用 session token Cookie 与 session 表，Cookie cache 是额外可配置层。仅判断 Cookie 是否存在不能替代受保护页面、API 和写操作中的服务端会话验证。[邮箱密码](https://better-auth.com/docs/authentication/email-password)、[会话管理](https://better-auth.com/docs/concepts/session-management)、[Cookie](https://better-auth.com/docs/concepts/cookies)、[Next.js 保护说明](https://better-auth.com/docs/integrations/next)。

工程建议：首版使用数据库会话，把认证表与学习业务表分开组织；学习记录关联认证 user ID。以注册、登录、刷新后持续登录、退出与撤销会话、受保护写操作为验收闭环。邮箱投递和密码重置需要真实配置，不应把库提供接口等同已完成业务。

## 官方事实：Vercel 语音与函数边界

| 项目 | 2026-10-07 核查结果 | 项目含义 |
| --- | --- | --- |
| HTTP streaming | 支持 Web Streams/流式响应，官方有 Next.js route 的 SSE 示例 | 回合式提交音频后流式返回文本/事件可作为候选；不必预设使用 WebSocket |
| WebSocket server | 2026-06-22 发布 Public Beta，运行于 Fluid compute | “Vercel 完全不能当 WebSocket server”已过时；连接仍受函数时长限制，需重连与外部持久状态；未验证直接套入本项目 Route Handler 的实现方式 |
| 单次执行时长 | Fluid compute：Hobby 默认/最大 300 秒；Pro/Enterprise 默认 300 秒、常规最大 800 秒；支持运行时可申请配置到 1800 秒的 Beta 路径 | 流式响应也计入本次 invocation 总时长；一次学习会话可有多个请求，不能把产品会话长度与单请求上限混为一谈 |
| 请求体 | 官方限制页列 4.5 MB，超限返回 413 | 录音需要按编码和时长核算；大文件宜通过受控直传对象存储避免经过函数请求体 |
| Node 函数体积 | 标准未压缩上限 250 MB；Large Functions 的 5 GB 为 Beta，存在运行时/网络功能条件 | 不直接套用旧教程的 50 MB；打包 FFmpeg 后应测真实产物 |
| 系统依赖 | Container Images 已在所有套餐开放 Beta；官方明确列 FFmpeg 为容器适用场景，容器仍继承 Functions 限制 | FFmpeg 不构成自动排除 Vercel 的理由，也不表示当前源码不改即可成功部署 |

来源：[Streaming](https://vercel.com/docs/functions/streaming-functions)、[WebSocket Public Beta 公告](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)、[WebSocket 生命周期说明](https://vercel.com/i/websocket-vs-server-sent-events)、[Functions 当前限制](https://vercel.com/docs/functions/limitations)、[大上传处理](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)、[Large Functions 公告](https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size)、[Container Images](https://vercel.com/docs/functions/container-images)、[Docker/FFmpeg 官方说明](https://vercel.com/kb/guide/does-vercel-support-docker-deployments)。

注意：搜索索引仍能返回旧版“不支持 WebSocket”和旧时长限制；上表依据已打开的当前限制页、当前产品文档及更新公告，不据旧缓存作结论。WebSocket 专门文档本轮两次抓取超时，Beta 状态与基本边界由官方更新公告和官方解释文交叉核实。本文不把 4.5 MB 机械套用到所有流式传输细节；具体音频响应模式应实测。

## 当前代码与实施建议

本地代码事实：`src/lib/auth-core.ts` 目前是自制 JWT；`src/lib/speaking/audioConvert.ts:6–13` 使用 `fluent-ffmpeg` 与 `ffmpeg-static`，优先本地二进制；`src/app/api/speaking/chat-stream/route.ts:19` 明确 Node.js runtime。当前代码事实不代表生产环境已经验证。

建议优先以 Next.js + Better Auth + Drizzle/Neon + Vercel Node runtime 做一个部署验收切片：注册登录、创建学习记录、一段代表性录音上传、语音处理、流式事件与音频播放。检查 Linux 二进制打包/可执行性、产物大小、CPU/内存、请求大小、时长、取消及失败后的数据状态。若标准函数无法满足已测需求，再决定是否使用容器或拆出媒体处理；这轮没有证据要求换另一家供应商。

用户已明确需要同时覆盖中国大陆和海外；本轮未完成两类地区的真实访问测试，平台集成便利不能证明网络体验符合要求。仍未知：首版实时语音交互形态、最大录音时长/格式、具体部署地区、目标套餐、流量规模、是否接受 Beta 能力。以上候选不依赖默认采用 WebSocket、容器或扩展时长 Beta；最终设计应尽量由实际需求决定。
