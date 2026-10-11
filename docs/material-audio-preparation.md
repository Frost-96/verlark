# 首份真实材料的生成与人工审校

此入口仅供离线制作。它不上传 Blob、不发布内容、不填写人工审校意见、不调用 ASR 或反馈。生成后的音频必须由人完整试听并核对材料原文、角色、释义、提示与表达任务。自动 WAV 检查不能证明听感或内容正确。

## 首份材料

`content/weekend-plans-v1.json` 已用于开发版本。实际材料使用新版本 **2**，不能覆盖不可变的版本 1。在仓库外创建权限为 0700 的制作目录，将该内容复制为 JSON，把 `revision` 改为 `2`；无需改动原文，其四个话轮使用 A=`loongeva_v3.6`、B=`loongjohn`。制作入口自动移除开发 `audioPath` 与已有 `privateAudio`。

先在百炼控制台确认 **北京、精确模型 `qwen-audio-3.0-tts-flash`** 的剩余免费字符数、有效期与用完即停设置。`MATERIAL_AUDIO_FREE_CHARACTER_BUDGET` 是从已核实余额中给本次制作分配的字符预算，必须覆盖全部话轮；并发制作须人工分配互不重叠的预算。此值不是账户余额查询，也不保证账户计费。免费额度到期、不足或停止控制失效时停止。

环境使用 `DASHSCOPE_API_KEY` 与 `DASHSCOPE_API_HOST`（`ws-<workspace>.cn-beijing.maas.aliyuncs.com`），由现有 `.env.local` / `.env` 或安全环境提供；不要把密钥放进命令、制作记录或提交。明确设置 `MATERIAL_AUDIO_GENERATION_ENABLED=true` 与本次 `MATERIAL_AUDIO_FREE_CHARACTER_BUDGET` 后运行：

```sh
pnpm exec tsx scripts/generate-material-audio.ts /absolute/private/weekend-plans-v2.json /absolute/private/weekend-plans-v2-run
```

每轮完整文本各发一次同步请求，角色标签不朗读。固定请求：WAV、24 kHz、英文、语速 1、音量 50。下载后修正本次实测的 PCM WAV 流式占位长度，以既有有界 FFmpeg 完整解码为 16 kHz 单声道 PCM，话轮间加 300 ms 静音。最终须满足 120 秒 / 8 MiB 上限；不以截断方式满足上限。每轮 600 字符、总计 12 轮是本地试验限制，不声称是供应商统一上限。

## 回执、恢复与审校

输出目录是私有制作档案，不放入 Git/public，不分享包含签名 URL 的 `*.response.json`：

- `plan.json`：完整内容、摘要、模型、主机、音色、文本及参数与本次预留字符数。
- `turn-N.request.json`：请求发送前排他写入并刷盘；结果未确认前保留为 unknown。
- `turn-N.response.json`：已确认成功的 request ID、用量、短期下载 URL。HTTP 失败另留 `failure.json`；不记录供应商错误原文。
- `turn-N.wav` / `turn-N.download.json`：原始下载与字节摘要。下载只允许北京官方结果域名，提升为 HTTPS，拒绝重定向；超时与流式大小均有上限。
- `material.wav`：可试听、完整封装的合成音频。
- `review.json`：绑定确切内容与音频摘要的待审校包，模型、角色音色与制作摘要保留；审校人、时间和结论保持空白。

同一命令可恢复**已成功合成的下载**，复用完整回执，不覆盖已有音频或人工审校字段。内容/版本/参数改变须使用新目录；先核对已发生用量，不得用新目录绕过 unknown。

存在 `request.json` 但无 `response.json` 时，远端可能已扣额度，程序拒绝自动再次合成（包括确定 HTTP 失败）。保留预留并使用 request ID、控制台记录与账单对账；没有远端幂等或查询保障时不能删回执盲重试。签名 URL 过期、部分落盘、音频损坏或占位格式改变也可能需要人工恢复；不会自动重新生成。文件写入中断留下损坏回执时停止检查，不能当作请求从未发出。

人工审校完成后，填写 `review.json` 的 `review.reviewer`、`review.reviewedAt`（UTC ISO 时间）、`review.note`（实际试听与内容检查结论）。如需要改内容或音频，重新制作并重新审校。发布仍是独立操作，使用既有 `scripts/publish-material-audio.ts`，先满足其私有 Blob、数据库与免费权益门槛；生成成功不授权发布。

## 协议依据

2026-10-11 核对：[HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)、[系统音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)、[模型卡](https://help.aliyun.com/zh/model-studio/qwen-audio-3-0-tts-flash)。该模型与旧 `qwen-tts` / `qwen3-tts-flash` 的接口及音色不能混用。占位 WAV 头依据本次已取得的百炼样本；仅识别该确定布局，再通过完整解码检查，不放宽学习者录音校验。
