# 识别请求生命周期诊断

2026-10-14。生产重试在 fetch 阶段 45,003 ms 截止、没有 HTTP 状态；随后当前电脑用同一 41.7 秒录音、同模型／host／45 秒截止得到识别成功。本地成功不能证明生产网络恢复，也不能将差异直接归因为 DNS、TLS、上传或供应商处理。本变更仅为下一次有限生产请求提供阶段证据。

在原 Adapter 外围观察 Node Undici diagnostics_channel，不替换 Next.js patched fetch、dispatcher、请求协议或截止时间；没有改变状态写回、预算或重试行为。每次调用使用独立 AsyncLocalStorage token，在匹配目标 origin/path 的 request:create 中捕获请求对象，再以 WeakSet 关联 bodySent/headers/error；sendHeaders 同样必须匹配已捕获的 request 对象，不以连接池事件或 host 推断归属。跨请求异步交错不能仅凭相同 URL 关联。

每次成功或 unknown 最多输出一条 `transcription-lifecycle` 摘要：固定模型、总耗时、有界 30 项 timeline。阶段限定 request-created/request-headers-sent/body-sent/headers/request-error，附带阶段耗时、TLS 布尔或 100–599 的 HTTP 状态。不输出 URL、地址、request ID、headers、错误、录音或文本。原 unknown 安全分类事件仍保留。结束时 finally 卸载本次全部监听；观察回调和摘要日志失败不改变识别结果。

解释边界：body-sent 只证明客户端传输事件，不证明供应商已收到或完成处理；request-headers-sent 的 TLS 布尔不单独提供 DNS／TCP／TLS 各段时长；此前区间合并了排队与连接等待；运行时若不提供事件或上下文无法关联，timeline 可为空，不能把空摘要当成未发送证据。

TDD：并发／隐私／卸载测试先因缺少摘要失败，实现后与既有识别 Adapter 及安全分类测试共 14 项通过。覆盖异步 fetch wrapper、并发同 endpoint、同 endpoint 的无关上下文事件、unknown／空事件摘要与监听卸载。该 wrapper 测试覆盖异步上下文传播，不冒充已执行 Vercel 的 patched fetch。定向 lint、类型检查通过；webpack 生产构建通过。没有执行真实供应商调用或部署；必须通过后续受限生产日志确定实际阶段。

Spec 审查后移除无法严格关联 request 的三种连接池事件，改以 WeakSet 过滤 `undici:client:sendHeaders`；新增同 host、同 async context 但不同 request 对象的旁路事件验证，先红后绿。真实 Node fetch 的本机 HTTPS 回路（只监听 127.0.0.1，使用临时自签名证书）实测：正常请求 32 ms 得到 created→request-headers-sent(TLS true)→body-sent→headers(200)；200 ms 截止请求 204 ms 得到 created→request-headers-sent→body-sent→request-error。两条路径均检查监听状态恢复。该回路没有调用百炼，不冒充 Vercel 实测；临时脚本在 `/tmp/verlark-lifecycle-local/probe.cts`。
