# #20 v6 严格结构与有界推理验收计划

2026-10-12，Asia/Shanghai。实现 `11abbbe` 已合入，**未执行 v6 真实供应商请求，不能关闭 #20**。

## 改动与依据

保持 `qwen3.7-flash-2026-07-15`，用通用理解流程缩短提示，启用 strict JSON Schema、`enable_thinking=true`、`thinking_budget=1536`、`max_completion_tokens=3072`。完整 payload 字节、总输出及256余量共同预留；有可解析供应商回执时先记 ID/用量，再拒绝截断或损坏内容。reasoning 不进入结果和持久记录。保留45秒期限、未知即停、无自动重试。

官方协议依据：[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)、[OpenAI兼容接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)。文档支持不等于固定快照实际兼容，先用两例探针验证，再决定是否执行完整样例。

## 冻结验收与额度

实现者未接触新的14例保留集。两例兼容探针、六例已知回归、十四例新保留样例已冻结；[语义准则](quality-v6-rubric.md)明确：借入/借出在上下文已清楚时不强制算错；不能通过摘要擅定人物、时间或含义。原始失败不丢弃，不调整后重跑同集来冒充独立证据。

每请求预留6230加输入JSON转义后的UTF8字节；兼容两例12,589，回归六例37,646，保留十四例87,976，合计22请求、138,211预留。旧账本86行／297,411预留保留；本计划执行后静态预期435,622，实际仍以账本的预留与报告用量较大值为准。

已向用户提出最多22次／追加200,000预留／2小时、累计上限497,411的有限免费试验，当前尚未收到该轮授权。不设置新截止时间，不运行。旧轮20次上限已用满，不能因剩余token或“继续”字样自行扩额。执行前还须重新核对百炼免费额度和用完即停。任何未知立即停，不自动重试或更改协议后再次发送。

输入SHA256：
- compat：24b9f20ae71ffece35ba1a53c78d1c20ec3edcc36b0f96508b389010aaca35ad
- regression：7b6e271ff8c5685c272d80b35a8bea9d86a1dfe3b1b5ad0a1ca3dc8df5a639bd
- holdout：927dac79b7ee0a923b1a6384c0e5d8985eb42596e731d2e9c3f16b7efba19c06

## 已执行验证

实现者完成两轮红绿、9项Adapter/config测试、TypeScript及目标ESLint。合入后Adapter/config/practice反馈三文件35项测试通过，真实隔离PostgreSQL、mock供应商传输，未写旧实时账本。双轴静态审查各0项可操作发现，见[审查记录](quality-v6-review.md)。这些证据不证明真实兼容性、时延或语义质量。
