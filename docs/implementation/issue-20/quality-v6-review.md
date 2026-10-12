# Standards review — v6

范围：`git diff 2701cdf...11abbbe`，唯一提交 `11abbbe`；已确认差异非空，涉及反馈 Adapter 及其测试两个文件。只读审查，未执行真实调用或修改代码。

## 硬规则违规

未发现。依据 `AGENTS.md`、`docs/agents/domain.md`、`docs/architecture-proposal.md`、领域词汇与已接受 ADR：供应商协议及回执仍封装在 Adapter，未进入页面或绕过 practice 修改业务状态；提示版本更新，预算仍覆盖完整请求与总输出预留。收到可解析供应商回执后先记录 ID 与用量，再拒绝截断或损坏内容，符合持久对账要求。失败、未知和成功路径均不退还预留，相同 request ID 不重发。

测试仍通过 Adapter 公共调用与外部 transport 替换验证拒绝、预算不足和不重发行为；隔离 PostgreSQL 中的额外查询用于验证明确要求的持久用量/回执，而非断言内部业务调用链。私有 reasoning_content 未写入账本或反馈返回值。

## 判断性代码异味

未发现值得要求修改的新增异味。issues 与 alternatives 共用 suggestionSchema，新增协议结构集中在既有 Adapter，未引入不必要抽象或跨模块数据操作。预算常量在 payload 与预留计算间复用，避免两处输出上限分离。

## 边界

静态审查与合成 transport 回归不能证明供应商实际接受 json_schema、thinking_budget 或 max_completion_tokens，也不能证明模型语义质量；这些须由既有官方协议核验及授权真实试验提供证据。本审查没有执行或宣称这些外部验证。

结论：硬规则违规 0，判断性异味 0。

## Spec

审查范围固定为 `git diff 2701cdf...11abbbe`，提交 `11abbbe`。依据：首版规格 F01–F03、#20 acceptance、`/tmp/verlark-feedback-completion-plan.md`。只读静态审查；未调用模型、未读取新保留集、未修改实现。

**无可操作的差异缺陷或范围扩张发现。**

- F01「问题数为零至二；清楚表达样例允许无纠错项」：schema 保留 generated/no-content 两类、完整字段、零长度数组与最多两项；没有强制纠错或后处理清空问题。更严格长度上限不增加业务概念。
- F03「非法供应商响应和供应商失败不产生有效反馈」：供应商 strict schema 之外，现有 practice 公共接口仍严格校验引用、语言、字段及音频评价；schema 本身不被当成语义保证。finish_reason 非 stop、损坏内容、超限响应均不能成为有效反馈。
- #20「每次保留输入 UTF-8 字节 + 输出上限 + 协议余量」：新增 `max_completion_tokens=3072` 包含思考与回答，预留同步采用完整 payload 字节 +3072+256；1536 思考预算未重复加算，也未沿用旧1024输出预留。原累计账本、截止时间、唯一 request ID 防重发保留。
- #20「未知时先停止，保留供应商回执和最坏预留」：有效 provider ID/usage 在判断截断及内容前写入，未知不退额度；原复验脚本遇 unknown 即停止。reasoning_content 不持久化或返回为反馈。

**验收待证，不是新增代码缺陷：** F01–F02 要求“实际反馈样例”。该提交没有证明锁定快照对 strict schema + thinking 的真实兼容性、延迟或语义改进；仍须按冻结准则执行有限真实验收及业务回放。当前不能据静态审查或 mocked transport 测试关闭 #20、宣布质量通过或启用生产。

结论：静态 Spec 可操作发现 0；真实质量验收仍未完成。
