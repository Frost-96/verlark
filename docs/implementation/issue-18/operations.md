# #18 清理与部署运行验收

2026-10-11（Asia/Shanghai）。本记录继续追踪 #18，不能替代未执行的云端、供应商及实机验收。

## 已发现与修复

现有每日入口只执行录音清理及删除回执收缩，没有执行材料清理。现在通过公开内容模块同时执行有界材料维护批次；材料失败不会阻止录音维护，所有分项完成后分别报告结果。版本仍遵循撤下、零引用且最后引用释放满 30 天的条件，不改保留政策。

`GET /api/maintenance/recordings?mode=status` 是受同一密钥保护的只读日检：不执行删除，不刷新扫描成功时间。录音已到期但尚在重试等待、材料仍持有处理权时都计入未完成总数；避免下一次重试时间暂未到达时误报健康。配置或数据库失败返回中文 503，不输出内部错误。

部署此改动后，维护者在仓库根目录执行：

```sh
# 默认只读。退出码 0=健康，1=有未完成或逾期，2=无法验证。
pnpm exec tsx scripts/check-media-maintenance.ts https://articu-lab.vercel.app

# 备用手动执行一次有界扫描；此命令确实会清理达到规则的文件。
pnpm exec tsx scripts/check-media-maintenance.ts https://articu-lab.vercel.app --run
```

脚本读取现有环境中的 CRON_SECRET，不将其写入参数或日志；拒绝重定向，避免密钥转发。HTTP 200 本身不代表清理已完成，必须检查 attentionRequired、pending、materials.pending、scanOverdue 和 cleanupOverdue。每日调度仍为 UTC 03:00（北京时间 11:00）；Hobby 调度精度及实际触发以平台运行记录为准。

## 生产配置预检

Vercel 项目 `verlark` 的生产域名为 `https://articu-lab.vercel.app`，预检时部署对应 master 的 `3962b9b`。平台显示 Ready，但当时观察到配置不完整：

- 项目环境变量搜索未找到 BETTER_AUTH_SECRET、BETTER_AUTH_URL、TESTER_EMAILS、CRON_SECRET、PRIVATE_RECORDINGS_ENABLED 和 RECORDING_UPLOADS_ENABLED。
- DATABASE_URL 是早前已存在的 Secret，未读取其值，不能假定它已经指向新的 Neon 数据库。
- BLOB_READ_WRITE_TOKEN 已存在，未在页面揭示其值。
- 2026-10-11T14:15:00Z 匿名请求：首页 200、`/api/auth/get-session` 503、维护入口 401、已发布材料音频入口 500。没有执行登录、真实录音或修改云端数据。

已准备仅本人可读、被 Git 忽略的本机 `.local-snapshots/issue18-production.env`，复用本机已配置的新库和现有密钥，域名改为生产 origin，所有开发替身关闭，新增上传仍关闭。需维护者在 Vercel 仅录入 Production；现有 DATABASE_URL 单独更新，旧资源不删除。环境变量保存不会改变现有部署，须随后部署再验。此文件不提交、不发送到聊天或工单。

维护者随后报告已保存配置；页面核对发现新变量同时覆盖 Production 和 Preview，且密钥被保存为 Config。维护者确认实际导入了本地 `.env`，其中 BETTER_AUTH_URL 指向 localhost、DEVELOPMENT_MAIL=true、RECORDING_UPLOADS_ENABLED=true。已请求使用准备好的生产文件纠正；维护者授权代理导入后，自动审批因凭据录入必须本人完成而拒绝上传。未绕过该限制。修正前不推送会触发 Preview 的分支，也不部署生产。

## Blob 清理完成仍缺少的证据

核对 `@vercel/blob@2.8.1` 声明、实现和[官方签名 URL 文档](https://vercel.com/docs/vercel-blob/vercel-signed-urls)：`put` 委托同时覆盖单 PUT 和分段 POST；SDK 的签名规范包含 operation、pathname 和上传约束，未把“仅单次 PUT”作为独立权限。不能只让正常客户端设置 multipart=false，就声称取得许可的其他客户端不能发起分段上传。

官方文档提供 ifMatch 条件写入，但它解决的是已有对象版本竞争；它本身没有证明未完成分段已经物理清除。SDK 的公开接口包括创建、上传分段和合并，未找到可枚举／终止全部未完成分段的接口。客户端 abortSignal 或许可过期也没有提供可核验的远端终止完成回执。

因此，仍保留现有“拒绝业务访问、反复删除已知对象、清理未完成”的行为。没有设置任意等待时间、改变保留期限或切换付费存储。需要供应商确认可依赖的终止／回收边界，或在具体替代方案核实后由维护者决定调整架构。[咨询正文与发送状态](blob-support-question.md)不含密钥、对象路径或学习者数据。维护者授权后已发送到 Vercel Support 官方助手；助手生成答复失败。转工单并选择 CDN > Blob 后，页面明确表示 Hobby 需使用社区或付费账户，未生成工单号。尚无供应商答复；维护者已授权公开社区发布，首次登录仍需确认身份授权及社区协议；尚未公开发帖。

## 下一轮运行验收顺序

1. 完成 Production 配置，部署本轮修复；先保持新增上传关闭。用已验证的现有测试账号登录，验证已发布版本 2 的材料 GET/HEAD/Range 与页面播放。真实邮件接入仍属 #21，不能启用开发邮件替身规避生产限制。
2. 用维护脚本执行一次扫描并查看只读状态；随后观察平台真实 cron 触发日志和扫描时间。配置独立监控或由维护者承诺日检；本机脚本本身不是已运行的监控。
3. 在隔离环境验证故障、重试及恢复；当前新增测试已覆盖材料删除失败、处理权到期后的接手、保留仍在使用的材料，以及录音未完成状态。没有在业务库注入时钟或人为耗尽免费额度。
4. 备份恢复必须先隔离恢复目标，取得覆盖备份之后删除操作的完整标记与文件清单，重放删除并对账后才开放。独立日志和重放工具的最新实现、隔离演练、初始化与限制见 [恢复与运行补验](recovery-plan.md)。生产尚未初始化并启用该日志；**只恢复现有旧快照仍会一起回退标记**。缺少完整标记时保持恢复目标关闭，不让用户登录后再补删。
5. 免费层暂停后的读取、管理删除与恢复路径须取得当前账户下的证据；不要主动耗尽正式额度。应用侧暂停不等于供应商停用，不能相互冒充。
6. 网站可用且上传安全条件满足后，再由真实 iPhone Safari、Android Chrome、电脑及大陆／海外网络测试录音、试听、提交、刷新后的历史回放和删除。记录设备、浏览器、容器、字节、时长及 Range 结果。模拟视口或代理出口不当作实机／真实地区证据。

## 本轮验证

- 独立 PostgreSQL `verlark_issue18_operations_test`：原入口复现四项失败（材料不清理、只读日检实际会执行扫描、材料失败未上报、配置错误未捕获），修复后通过；另一个回归先复现录音重试等待期间误报健康，再修复。
- 维护、私有录音、材料及删除四个测试文件合计 **33 项通过**。外部对象存储只在 Adapter 边界使用内存替身，未冒充真实云端测试。
- 类型检查、ESLint、格式检查通过；没有数据库 schema 变更。
- 在独立源码快照目录完成 `pnpm exec next build --webpack`，Next.js 16.4 的编译、类型检查、静态生成与路由跟踪通过；未污染运行中的开发服务器构建目录。这是本机构建，不等于云端构建。
- 未部署本轮改动，未观察真实定时触发，未执行设备／地区或备份恢复验收。

## 2026-10-12 生产配置修正与上线

维护者修正录音上传和开发邮件开关后，页面实际复核 `RECORDING_UPLOADS_ENABLED=false`、`DEVELOPMENT_MAIL=false`；登录 origin 正确，私有录音开启、开发录音关闭。通过现有变量编辑表单保留原值，把 CRON_SECRET、BETTER_AUTH_SECRET 转为 Secret，并把本轮 11 个应用配置限定在 Production；未导入或重新录入密钥。DATABASE_URL 已是 Production Secret，其实际连接通过线上维护查询验证，不在页面读取值。

- [PR #36](https://github.com/Frost-96/verlark/pull/36) 已合并，生产提交 `5a08ea01cb4b1ed7166ed3aa3390f7b47720e4fc`。Vercel 生产部署 `9q9EYxvKhoc4p1YqzLL9mNjbxihF` Ready，域名 `https://articu-lab.vercel.app`。云端构建约 42 秒。
- 2026-10-12T07:41:08Z 正确维护密钥的只读状态请求成功，未刷新旧扫描时间；同一入口匿名访问返回 401。
- 07:41:32Z 脚本执行一次真实有界扫描成功；录音 due/pending 与材料 pending 均为 0，attentionRequired=false。这是空扫描，不是有文件删除证据。
- Vercel Cron 页面显示 Enabled，计划为 UTC 03:00，每日北京时间 11:00，Hobby 提示一小时弹性窗口。平台 Run 手动触发后，07:42:09Z 的只读查询确认完成时间更新为 07:42:01.293Z；不能将这次手动触发写成自然定时触发通过。
- 已发布材料音频匿名访问返回 401，Cache-Control 为 private, no-store。登录后播放仍待测试账号登录。
- `/api/auth/get-session` 返回 404，经源代码核对属于接口未开放的预期行为，不能拿该路径作为登录健康检查。生产登录是否成功单独验收。

本节上线时，供应商终止／分段回收保证、自然定时触发、独立删除日志与隔离恢复、免费层停用恢复以及真实设备／地区仍未通过。后续独立恢复实现和演练已在 [PR #38](https://github.com/Frost-96/verlark/pull/38) 交付但未生产启用；17:43 已发布[社区咨询](https://community.vercel.com/t/verifiable-cleanup-of-in-flight-and-incomplete-multipart-uploads-in-private-blob/50608)，尚无人工作答。最新证据见 [恢复与运行补验](recovery-plan.md)。#18 保持开放。
