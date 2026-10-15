# 上传暂停原因提示修复

2026-10-15。本次只修改错误传递与提示，不改变维护门槛、额度、上传许可、保留期限或重试规则。

## 已确认问题与恢复

生产新增录音许可因维护保护暂停时，`issueUpload` 抛普通异常；上传路由隐藏为通用 unavailable，Recording 又将非成功响应解释为网络问题。09:12Z 只读状态显示扫描逾期、清理逾期和 actionablePending=1。该项为 10 月 12 日已经删除的旧练习录音；旧对象不存在证据超过 26 小时，录音到期超过 48 小时。09:22:56Z 经用户明确授权执行一次正常有界维护，09:23:07Z 只读核验两个 overdue=false、actionablePending=0、attentionRequired=false；providerUnverified=1 仍保留，不代表供应商物理回收已完全验证。

## 代码行为

私有录音 Adapter 为维护暂停和额度待核实暂停分别发出类型化原因；practice 映射为固定错误码，上传路由保持 503 与 private/no-store。客户端只接受两个明确错误码，并使用本地固定文案，不显示服务端 message 或原始异常。草稿仍可试听，提示不要关闭或刷新页面；维护者恢复服务后可用原上传标识重试。未知异常仍使用通用安全响应。

## 本地验证

- 真实会话 → 上传 handler → practice → 私有录音 Adapter：维护/额度两例先 RED（收到 unavailable）后 GREEN；暂停时对象存储 authorize 调用为零，未形成作答。另验证 authorize 原始异常不泄露，最终 practice 文件 15 项通过。
- 原相关 practice/audio/private/UI 四文件 27 项通过（追加未知异常对照前）。TypeScript、定向 ESLint、格式化与 `next build --webpack` 通过。
- 浏览器实际 Recording 组件：两类暂停先 RED（错误地提示检查网络）后 GREEN；桌面与移动模拟视口共 4 项通过。响应故意含敏感文本标记，UI 不显示；草稿 URL 不变，恢复后同 reference 只接收一次。
- 浏览器测试使用既有 Vite 组件夹具，在 HTTP 边界替身化服务响应；默认 Next dev 因工作树 node_modules 跨根 symlink 受 Turbopack 限制，使用临时独立 Playwright 配置运行组件测试。真实 route 链路由隔离本机 PostgreSQL 测试另行覆盖。移动视口不是实机证据。

本次修复未部署、未调用模型，未额外执行生产维护。
