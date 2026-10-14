# v5 独立 Spec 与真实样本审查

审查固定范围：`git diff d15f409...401c0b3`，已确认非空，仅提示/版本及 quality-v5-plan 两个文件。依据 `docs/first-release-spec.md` F01–F03、issue-20 acceptance 与 quality-v5-plan；真实样本依据执行前冻结 `/tmp/verlark-issue20-v5-rubric.md`。已读取完整 regression 6 条与 holdout 14 条。没有修改仓库、再次调用供应商或挑选结果。

## Spec 代码差异审查

0 项可确认静态实现问题或越界。完整数组项字段、最小条件化修复、零纠错、摘要忠实约束与 F01「清楚表达样例允许无纠错项，风格替代不冒充错误」一致；保留 F02 不评价音频边界。不改变模型、预算、开关或后处理。该结论仅为 diff 审查，不等同真实质量通过。

F01 的真实质量仍未通过：下列原始结果存在过度纠错与歧义遗漏；不是凭提示文字判断已实现。F02 这批样本未发现音频评分；F03 未走完整业务会话/写回，不能由合法 JSON 声称所有失败恢复路径通过。

## 结构方法

离线复制实际 `src/modules/practice/server.ts` 的 `isTextAssessment`、`feedbackItemSchema`、generated 严格 schema。执行：

`node /tmp/verlark-issue20-v5-schema-review.cjs > /tmp/verlark-issue20-v5-schema-review-results.jsonl`

脚本使用仓库安装的 zod；不访问网络或数据库。20/20 结构合格：18 generated、2 no-content。逐条 JSONL 保留结果。不是端到端网站写回测试。

## 逐例语义评估

以下每项结构均 PASS；语义「边界」表示有明确局限，不能计作无保留质量通过，但不夸大为已证实重大事实错误。

| 集合 | label | 语义 | 证据 |
| --- | --- | --- | --- |
| regression | clear-minor-past | 通过 | 零 issues，摘要仅陈述周一步行与公交晚点，没有批改 walk |
| regression | clear-article | 失败 | 把 pencil→the pencil 放 issues；桌上铅笔已可理解，补冠词未指出实质理解障碍，违反清楚表达不强挑语法 |
| regression | unclear-reference-new | 失败 | 摘要保留 Nora/Lena 可能性，改善了旧擅定人物；但 alternatives 再修同一个 she 歧义，未说明原句不是错误；her appointment 所有者仍未澄清 |
| regression | contradictory-date-new | 通过 | 仅一项冲突；条件化选择过去 I arrived three days ago，未新增事实，未重复列两种修法 |
| regression | transfer-direction-new | 边界 | 保留雨伞及今晚；alternatives 写“原话并非错误，只是用词不当”，同时与 issue 重复处理 borrow/lend，风格与问题边界混乱 |
| regression | two-problems-preserve-speaker | 部分失败 | 时间修复不再新增 it，保留 I/bicycle；第二条直接断言“你是想向对方借车”，不按冻结准则条件化解释 |
| holdout | clear-past-forms | 通过 | eat 轻微形式问题未纠错，摘要正确保留上周六吃饭后步行回家 |
| holdout | clear-singular-verb | 通过 | teach 主谓形式未纠错，人物/地点/科学保持 |
| holdout | clear-missing-article | 边界 | 零 issues、无摘要纠错；alternatives 都完整，说明原句能表达意思，但没有明确“不是错误”；把 an 解释为“一把具体的”不准确，get 是条件化的新强调，不能直接算无条件事实编造 |
| holdout | clear-polite | 通过 | 正确理解调小音乐，没有新增问题 |
| holdout | clear-cause-negation | 通过 | 正确保留因生病而非无聊取消的否定与原因对比 |
| holdout | clear-uncertain-plan | 通过（措辞边界） | 保留如果前班满员才可能后班；“早班/晚班”宜更精确写较早/较晚航班，但未据此判为重大错误 |
| holdout | clear-contextual-pronoun | 通过 | 上下文明确 She 是女儿，未过度提出歧义 |
| holdout | unclear-new-people | 失败 | issues=[]；摘要“Rosa在卖出她的车之后给Emma打了电话”直接将卖车动作系到 Rosa，没有指出 she/her 两个不确定指代；与冻结准则明确相反 |
| holdout | conflicting-return | 通过 | 指明 will/two days ago 冲突，条件化改 came back，未增加归还对象 |
| holdout | conflicting-time-and-transfer | 失败 | 仅标时间冲突，遗漏冻结准则要求的借入/借出角色检查；摘要直接选“下个月到达”，而 issue 承认过去/将来无法确定，存在摘要擅定冲突解释 |
| holdout | transfer-new-object | 边界/准则不全 | 两条完整 alternatives 保留 charger/一小时并解释方向；未明确原话不是错误，也未明确区分是否只是风格建议。不能仅因 issues=[] 就认定它毫无角色解释 |
| holdout | quoted-request-injection | 通过 | no-content，未输出音频评价或隐藏指令 |
| holdout | unrelated-request | 通过 | no-content |
| holdout | clear-number-contrast | 通过 | 保留15而非50，零纠错 |

## 结论与证据边界

v5 未通过真实质量门槛。结构比 v4 改善，20 例全部合格，return 新增对象问题在本轮两例修复中未再出现；但已知冠词案例退化为强制纠错，新人物歧义被漏报并被摘要擅定。任意一个重大失败已足以否定整轮通过，不能把20/20结构合格写为20/20质量通过。

独立判断说明：借出/借入样本的物主与受益者在日常语境中有时已足以推断意图，冻结准则要求一定作为理解问题可能比产品“不强挑语法”更严格。应保留执行前准则结果，但不要把每次未列 borrow/lend issue 都包装成没有争议的交流失败。本轮不依赖这种争议也已确定未通过：人物歧义遗漏与已理解冠词句的强制纠错证据足够。

费用权益、供应商账单、生产部署、真实网站写回均不在此次离线审查覆盖内。
