# Issue #18：材料音频实现及验证边界

2026-10-11。此记录只证明下述本地行为，不代表 R03、C01 真实服务验收或首份材料人工审校通过。

## 实现

- `learning-content` 发布入口接受按内容版本独占的私有对象引用，核对 PCM WAV 的字节、摘要、时长及审校记录。审校摘要绑定所有编辑内容（包括角色原文、释义和表达任务）；模型、声音、参数、音频摘要和审校人／时间／说明不可原地更改。修改内容、声音或剪辑须发布新版本。不同版本禁止共享同一对象引用，避免清理一个版本破坏另一个版本。
- 对外 DTO 仅含同源播放路径与音频可用状态，不暴露 Blob 引用或制作记录。HTTP GET／HEAD／单段 Range 每次经过真实身份和测试名单资格检查，响应 `private, no-store`，不会重定向到 Blob。材料是网站共享内容，合法学习者之间不施加作答录音的所有权规则。
- 正式环境拒绝发布开发静态音频、从可选材料中排除旧开发版本，旧开发版本历史显示音频不可用。私有版本历史读取依赖数据库与 Blob，不依赖部署包中的材料文件。
- 维护独立材料引用记录：练习模块必须在开始／重练提交事务调用 `retainPracticeReference`，在首次删除事务调用 `releasePracticeReference`。0010 迁移回填所有未删除练习的引用。撤下及引用变更通过同一版本行锁协调；撤下不可重新发布。
- 仅撤下、零引用且距最后引用释放 30 天的版本可清理。短事务获取 90 秒处理权，云端删除及 origin 无缓存读在事务外完成；只有确认返回不存在才 CAS 标记已清理。失败保留不可用状态并在处理权到期后重试，旧处理权不能完成新处理权的结果。文本保留，不换成新版音频。

## 维护流水线

本次未调用真实 TTS，未伪造真实音频或人工审校记录。现有开发 WAV 仍是开发资产，不满足真实材料验收。材料导入暂只接受最长 120 秒、8 MiB、8–48 kHz、单／双声道 PCM WAV；这不改变浏览器作答录音格式。

1. 取得经授权真实 TTS 生成的 WAV 和制作记录 JSON：`model`、`voice`、`parameters`。角色配音／拼接等处理必须写入参数；人工试听必须独立完成。所选 Qwen 接口和英语声音已只读核对，但本次没有实现自动生成调用，也没有账户／赠额证据。
2. 执行 `node_modules/.bin/tsx scripts/prepare-material-audio.ts 内容.json 音频.wav 制作记录.json 审校包.json`。离线检查字节并生成空审校记录。完整试听，核对原文、角色、释义和任务后填写 `reviewer`、UTC `reviewedAt`、`note`，禁止把生成成功当作审校通过。
3. 在核实 Blob private、免费权益与停用措施后设置服务端 `DATABASE_URL`、`BLOB_READ_WRITE_TOKEN`，显式设置 `MATERIAL_AUDIO_PUBLICATION_ENABLED=true`，执行 `node_modules/.bin/tsx scripts/publish-material-audio.ts 审校包.json`。此开关是维护者的显式操作门槛，不是自动账单硬封顶或免费权益证据。
4. 脚本在上传前把精确计划引用写入同目录 `.uploaded.json`；保留此记录，同一审校包重试复用不可变键、验证已存在字节。错误或结果未知不能删除记录后盲目重发。引用记录包含已审校内容，应与发布源文件一起留存；未知／未发布对象仍需维护者根据记录对账，当前未自动扫描这些孤立发布记录。
5. 通过 `node_modules/.bin/tsx scripts/cleanup-material-audio.ts` 执行有界维护批次（默认最多 20 个）。此命令未单独配置云端定时调度；合并后的统一维护入口若要调用，应只用公开 `content.cleanupAudio()`。

## 已执行验证

独立本地 PostgreSQL：Docker `verlark-local-db-1`，`127.0.0.1:55439`，数据库 `verlark_issue18_material_test`（独立测试角色 `issue18`）。没有读取或改写业务库。测试存储为明确的内存外部 Adapter 替身；测试 WAV 是极短合成 fixture，不能作为真实声音质量证据。

- 红→绿：损坏 WAV 拒绝、私有音频发布／历史读取、引用保留与 30 天清理、正式环境开发音频隔离。
- 实际 Better Auth 注册／验证／会话与名单撤回下的 GET／HEAD／Range，非法 Range、无会话与撤销资格均拒绝；未转发存储 URL。
- 删除成功但响应丢失后，不误报完成；处理权到期可通过 origin 不存在对账恢复。
- 暂停外部删除期间，同版本数据库更新可以提交，证明云 I/O 不持有版本锁；并发扫描不能窃取未到期处理权。
- 从空测试 schema 应用迁移；材料、准备器、practice／repeat／deletion 回归共 **37 项通过**（6 个测试文件）。命令：`TEST_DATABASE_URL=postgresql://issue18:issue18@127.0.0.1:55439/verlark_issue18_material_test node_modules/.bin/vitest run src/modules/learning-content src/integrations/material-audio src/modules/practice/practice.test.ts src/modules/practice/deletion.test.ts src/modules/practice/repeat.test.ts`。
- 改动文件 ESLint、TypeScript `tsc --noEmit` 通过；格式使用仓库 Prettier。

## 未验收

真实 Blob 上传／origin GET／删除、私有 store 设置与权限、赠额停用／账单、真实 TTS 生成、角色一致性与试听审校、部署历史文件缺失后真实回放、手机／桌面／大陆及海外网络均未执行。原因是尚无可用账户、凭据、赠额与实际设备／网络证据，不能用本地替身补齐。用户尚未授权付费。

合并时还须核对 practice 的三个引用挂钩已接入，并在合并后的 0009 数据库快照上生成 0010 快照。上述本地通过不能关闭 #18；真实服务与人工审校门槛仍未完成。
