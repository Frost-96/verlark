# #18 私有录音验证记录

2026-10-11；进行中的代码交付，不表示真实服务或首版验收通过。

已实现并在本机验证：数据库上传清单；五分钟私有临时键写许可；服务端完整解码及摘要校验后写入从未授予客户端许可的不可变最终键；作答接收与文件到期时间同事务；30 天录音到期拒绝回放及重新识别；未接收上传 24 小时失效；所有者 GET/HEAD/单 Range 鉴权代理；删除及处理权失效后迟到完成不得恢复记录；有界、可恢复清理扫描及中文未完成状态。浏览器上传不经应用函数正文，生产禁用开发文件替身。

实际执行：独立 PostgreSQL `verlark_issue18_test` 上全套 99 项模块/Adapter 测试通过；随后新增真实 Better Auth 会话的 HTTP 范围、跨账号、匿名、删除与到期测试，所在文件 12 项通过。`pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。媒体测试使用生成的 WAV 字节，验证完整解码、伪造/截断/空/超长拒绝；不冒充真实人声或实机验收。

重要限制：SDK `@vercel/blob@2.8.1` 文档没有证明上传许可过期会终止此前开始的请求，也不能排除客户端利用许可调用分段上传。本实现永久封闭业务访问并反复删除、无缓存复核已知路径；只要曾签发直传许可，就保持清理未完成，**不会显示全部清理成功**。这是待解决的真实供应商边界，不能用任意宽限期冒充证明。需要真实存储测试、供应商可验证的在途/分段清理方案后才能满足完整 #18。

部署前须验证 Blob 私有存储账户与免费额度、清理管理权限、每日 cron 及独立监控，设定 `PRIVATE_RECORDINGS_ENABLED`、`CRON_SECRET`；先用受保护维护入口完成扫描，再明确开启 `RECORDING_UPLOADS_ENABLED`。未配置凭据的本机未进行任何真实 Blob 上传、签名读写或删除，也未部署 cron。额度耗尽后的恢复/清理、移动 Safari/Android、跨地区网络和 48 小时清理目标均未实测。生产新增上传默认关闭；未授权收费。

FFmpeg 使用锁定 `ffmpeg-static@5.3.0`，独立进程 15 秒超时，单音轨完整解码为 16kHz 单声道 PCM，输出最多 3,840,000 字节（120 秒），输入最多 8 MiB；固定容器白名单、协议白名单、单线程和单次分配上限。分配上限不是总 RSS 限制，仍需部署资源实测。构建追踪包含可执行文件及 GPL 许可/说明；本地 macOS 构建不是 Linux 部署验证。

官方依据：[Blob 私有存储](https://vercel.com/docs/vercel-blob/private-storage)、[Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)、[ffmpeg-static 源码](https://github.com/eugeneware/ffmpeg-static)。实际行为以锁定 SDK 声明和测试为准。未修改或删除任何旧 Supabase 云端资源。

后续集成验证：合入材料音频与练习引用生命周期后，全套 108 项通过；随后独立验证清理 21 个对象跨批推进、48 小时逾期在重试期限期间仍报警、校验租约接手、删除不等待外部写入及 30 天回执收缩。Chromium 桌面/移动视口的 `tests/e2e/recording.spec.ts` 4 项通过（34.3 秒）：真实 MediaRecorder 对假麦克风录制的 WebM 可由生产解码器完整解码，重新进入历史后同源鉴权 GET/HEAD/Range 与音频播放通过；同时保留丢失响应及双页并发回归。这不是移动 Safari/Android 实机或真实 Blob 上传验收。

集成分支维护者独立核查：锁文件安装、生产构建通过；上传路由 `.nft` 含 FFmpeg 可执行文件及许可/说明，排除 `.dev-recordings`，本机 macOS 追踪文件共 46.93 MiB。`db:verify` 两个空数据库的迁移、重复运行与读写检查通过。Linux x64 固定构建产物为 FFmpeg 7.0.2-static，79,826,272 字节，SHA-256 `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`；研究执行者在隔离 Linux 容器验证二进制及 WebM/Opus、Ogg/Opus、fragmented MP4/AAC 解码，不等于完整 Linux 应用部署验证。临时日志：`/tmp/verlark-issue18/build.log`、`/tmp/verlark-issue18/db-verify.log`、`/tmp/verlark-media-packaging-notes.md`。

代码审查修正：录音逾期统计独立于下次重试期限，超过 48 小时的未完成清理仍报警并阻止新增上传；材料清理用持久化处理时间推进批次，20 个持续失败对象不能让第 21 个版本永久饥饿（迁移 `0011`）；私有录音界面明确 30 天、120 秒及 8 MiB；两类回放共用单 Range 策略（80 字符、1 MiB），两类 Blob Adapter 共用无缓存、有界读取及超限取消。针对这些修正的 6 个测试文件、32 项测试与类型检查通过；最终集成全套测试及新增迁移验证由集成分支另行记录。
