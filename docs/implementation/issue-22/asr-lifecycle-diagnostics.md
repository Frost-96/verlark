# 识别请求生命周期诊断

2026-10-14。生产重试在 fetch 阶段 45,003 ms 截止、没有 HTTP 状态；随后当前电脑用同一 41.7 秒录音、同模型／host／45 秒截止得到识别成功。本地成功不能证明生产网络恢复，也不能将差异直接归因为 DNS、TLS、上传或供应商处理。本变更仅为下一次有限生产请求提供阶段证据。

在原 Adapter 外围观察 Node Undici diagnostics_channel，不替换 Next.js patched fetch、dispatcher、请求协议或截止时间；没有改变状态写回、预算或重试行为。每次调用使用独立 AsyncLocalStorage token，在匹配目标 origin/path 的 request:create 中捕获请求对象，再以 WeakSet 关联 bodySent/headers/error；连接事件同时要求对应 async context 和目标 host。跨请求异步交错不能仅凭相同 URL 关联。

每次成功或 unknown 最多输出一条 `transcription-lifecycle` 摘要：固定模型、总耗时、有界 30 项 timeline。阶段限定 request-created/connect-start/connection-ready/connect-error/body-sent/headers/request-error，附带阶段耗时、TLS 布尔或 100–599 的 HTTP 状态。不输出 URL、地址、request ID、headers、错误、录音或文本。原 unknown 安全分类事件仍保留。结束时 finally 卸载本次全部监听；观察回调和摘要日志失败不改变识别结果。

解释边界：body-sent 只证明客户端传输事件，不证明供应商已收到或完成处理；connection-ready 的 TLS 布尔不单独提供 DNS／TCP／TLS 各段时长。复用连接可能没有新的连接事件；运行时若不提供事件或上下文无法关联，timeline 可为空，不能把空摘要当成未发送证据。

TDD：并发／隐私／卸载测试先因缺少摘要失败，实现后与既有识别 Adapter 及安全分类测试共 14 项通过。覆盖异步 fetch wrapper、并发同 endpoint、同 endpoint 的无关上下文事件、unknown／空事件摘要与监听卸载。该 wrapper 测试覆盖异步上下文传播，不冒充已执行 Vercel 的 patched fetch。定向 lint、类型检查通过；生产构建结果以本轮交付记录为准。没有执行真实供应商调用或部署；必须通过后续受限生产日志确定实际阶段。
