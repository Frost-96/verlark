# 真实识别 unknown 的安全诊断

2026-10-14。针对本轮电脑真实链路：41.7 秒 WebM/Opus 录音已接收，识别函数约 55.19 秒后返回 HTTP 200，作答状态 unknown、无 provider request ID、保留 120 秒预算。原生产根因尚未确定；此变更增加后续受限验收的区分证据，不宣称识别故障已修复。

业务层对所有 unknown 均显示“本地请求异常”，该文案不是底层异常记录。默认 45 秒截止与本次总耗时相容，但总耗时还包括身份、数据库、文件读取和状态保存，不能据此确定超时。文件读取失败通常返回 failed/未发送；读取后的处理权检查若发生非业务异常，仍可能形成 unknown，下面 Adapter 日志并不覆盖该外层路径。

## 本地反馈回路与变更

基线 `bd1469d` 的真实 Adapter 经 Node fetch 访问仅监听 127.0.0.1 的临时 HTTP 服务，使用 3 字节合成录音和合成凭据。正常响应产生 recognized；250 毫秒截止、socket 断开、200 错误结构、超过 256000 字节响应、body 读取中断均稳定产生相同 unknown/无 request ID。因此现有生产记录不足以区分原因。临时诊断脚本位于 `/tmp/verlark-issue22-asr-loop.ts`，未读取或下载用户录音，也未调用供应商。

新增日志事件 `transcription-unknown` 仅包含以下白名单元数据：

- 固定模型名、枚举阶段 fetch/headers/body/parse。
- 枚举原因 timeout/network/empty-body/body-read/body-limit/schema/http。
- Adapter 耗时 elapsedMs，以及已收到响应时的数字 HTTP 状态。

不记录 URL、请求标识、密钥、headers、原始错误或响应、用户文本和音频。没有修改返回值、45 秒截止、处理权、费用预留或重试行为；unknown 仍不代表远端取消或未计费。没有增加数据库字段，也不将诊断元数据写入学习记录。

## 验证与剩余条件

先添加诊断回归，7 项均因缺少日志失败；增加最小实现后，与原 Adapter 回归共 12 项通过。测试校验各场景的阶段／原因、HTTP 状态、日志字段白名单，以及合成密钥／私人文本／原始错误／音频编码均未出现在日志中。定向 ESLint、Prettier 和 TypeScript 检查通过。

再次运行同一本机真实 fetch 回路后，五种故障分别记录 timeout/network/schema/body-limit/body-read，正常响应保持 recognized。故障仍保持 unknown，原“必须得到转写”的断言继续为红，这是保持失败语义的预期，不是证明生产已恢复。

仍需经授权部署后再进行有界真实验收，读取新日志才能缩小生产原因。若再次 unknown 且没有此事件，还需检查 Adapter 外层阶段；不得自动重试、增加超时或释放原 unknown 预算来掩盖未确定原因。上述为实现时的验证边界；后续生产部署与唯一重试记录如下。

## 第二窗口生产诊断

2026-10-14北京时间21:13:57至21:43:57的新有限授权允许同一录音仅重试1次、反馈最多2次，累计token预留上限100,000，邮件关闭。源码`79169cf`的Production部署`A6v5BzaVRJHpGJnPHsSfE4KEpDUU`于21:18:59 Ready。

唯一识别重试于21:19:47.275登记账本；生产事件记录`stage=fetch`、`reason=timeout`、`elapsedMs=45003`，没有`httpStatus`，函数总耗时55.22秒。此次证据确认fetch阶段触发本地超时，不能推断远端取消、请求未被接收或没有计费，也不能确定网络或格式根因。原作答仍无转写和供应商请求ID。

现有45／70／90／120秒超时层级顺序合理，尚未发现确定且可本地证明的代码缺陷；因此未改动超时或增加重试。第一次与本次unknown各保留120秒，共240秒，不释放或重建账本。反馈仍为0，未发送新邮件。

供应商只读近6小时审计模型列表仅见`qwen3.7-flash`／`qwen3.8-max`，搜索ASR暂无数据；查询覆盖及显示结果不足以证明本次未被处理或未计费。继续保留unknown，#22仍未通过。反馈关闭配置保存后重新构建的Production部署`DPaYcXq8wc72oxFcDVFoVuqo3jHm`于21:25:42北京时间Ready，源码`79169cf`，绑定`articu-lab.vercel.app`；邮件关闭配置始终保留。完整窗口和部署记录见[真实验收记录](live-acceptance.md)。


## 最后只读配置核验

Vercel Production与Preview当前的`DASHSCOPE_API_HOST`均为`ws-n0xtc9d3g23a02yk.cn-beijing.maas.aliyuncs.com`，与本地配置及百炼控制台一致。因此，旧#18环境快照缺少该项不能作为当前生产主机配置错误的证据。该核验只确认配置一致，不证明Vercel至供应商的网络可达性、请求成功或计费状态；未新增真实请求或部署。
