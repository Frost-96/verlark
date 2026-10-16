# 单区域对照：iad1 → sin1

2026-10-14。本次仅将函数区域设为 Singapore `sin1`，保留原 cron。host、模型、请求协议、45 秒截止及预算规则不变；这是待验证的区域对照，不是已确认的永久修复。

父级实际观测：同一41.7秒录音在本地约1.74秒得到成功；生产iad1的诊断请求在862毫秒出现request-headers-sent（TLS true），随后45秒截止，没有body-sent或响应headers。该证据定位到尚未观察到完整请求体发送的阶段，不能进一步断言地区、网络或供应商中的哪一项是根因；入口edge为sin1不等同于函数在sin1执行。

Vercel官方允许Hobby选择单区域，且区域表包含sin1；使用根vercel.json的regions配置，未新增已弃用的Next preferredRegion。

- https://vercel.com/docs/project-configuration/vercel-json#regions
- https://vercel.com/docs/functions/configuring-functions/region
- https://vercel.com/docs/regions#region-list

部署后的验收需确认实际transcription函数区域，复用同一原录音、同一浏览器正常重试入口，记录安全阶段耗时、结果与预算；数据库及Blob区域保持原值，因此跨区域读写耗时也须记录。本轮剩余一次识别，截止2026-10-14T14:43:13Z；不因构建等待而续期，未知预留不释放。成功也只能支持该次对照结果，不能据单样宣布地区为唯一根因。

本提交仅通过JSON解析与原cron值保持检查；没有发模型请求或部署。


## 实际生产对照

2026-10-14 22:34:37北京时间，源码`3082056`的Production部署`4WX7AKJpoWbKKaM6ui2No6nAYqeG`Ready；资源页确认transcription函数SIN1、Node.js 24、120秒。22:36:22.884请求执行28.13秒，生命周期26,964毫秒：created 17、request-headers-sent 753（TLS true）、body-sent 17,526、headers 26,956（HTTP 200）。总函数耗时覆盖其他步骤，但未单独测量数据库或Blob跨区域耗时，不能从总耗时推算它们。

22:37:43只读数据库确认同一原录音recognized，转写113字符，新账本22:36:23.853开始并settled 42秒。用户确认转写与原话一致；不记录正文及请求ID。旧生产三笔unknown共360秒继续保留，独立本地预留不改变。本轮3次ASR已用完；1次Max反馈后续确认succeeded，当前有效revision 1且零问题，已打通本次上传→识别→确认→反馈链路；其余验收缺项仍保留，详见[真实验收记录](live-acceptance.md)。

此次对照表明SIN1部署对该录音成功，保留单样本及链路差异的限制，不据此宣布地区为唯一根因或长期稳定性得到验证。


关闭反馈配置后，同源码`3082056`的Production部署`xc7rwVn6e4k8macRT2m5BwoMfe5p`于22:45:43北京时间Ready；邮件始终关闭。刷新真实页面确认反馈服务关闭提示与已保存的有效反馈同时存在，练习仍未结束。本轮截止后无新增模型调用，最终ASR 3／3、反馈1／2、邮件0。PR保持草稿，#22剩余缺项不因本次对照成功而关闭。
