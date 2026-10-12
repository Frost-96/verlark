# #18 生产恢复日志切换

2026-10-12（Asia/Shanghai）。本记录更新 [恢复方案](recovery-plan.md) 中“尚未部署／初始化”的历史状态；#18 仍未完成全部验收。

## 已执行

- 用户在本聊天明确允许临时阻断全部生产和预览访问，并在切换后恢复新版。此前全站阻断被自动审批拒绝，未生效；取得具体授权后才执行。
- 在 Vercel 发布临时维护规则，所有请求路径以 `/` 开头时拒绝访问。生产首页和维护入口返回 403；已登录 Vercel 的独立邮件 Preview 页面也显示 403，未把匿名预览的登录重定向当作隔离证据。
- 停止本机 3000 和 3101 的两个已核对 Verlark 服务。它们没有自动重启；旧代码不得继续连接业务库写入。生产数据库恢复清单和删除标记均为零。
- 按当前 Hobby 的 [300 秒函数上限](https://vercel.com/docs/functions/configuring-functions/duration#duration-limits) 等待入口阻断后的在途函数退出。18:36:42 再次检查生产库无其他连接；初始化期间另有数据库排他锁保护。此等待仅针对应用函数，不证明 Blob 在途或分段上传清理完成。
- [PR #38](https://github.com/Frost-96/verlark/pull/38) 于 18:32:51 合并；提交 `714d4bfb822a4c848aecb7a98aa5974e1df9ffef` 的生产部署 `H9Xm3LyvYoDtKcCA1YNbVeVRmoVZ` 于 18:33:44 Ready。正式域名已绑定新部署，维护阻断期间未开放业务。
- 执行 `recover-media.ts initialize`，结果为 `initialized=true, entries=0, audioWrites=false`。独立进程执行 `inspect`，读回 `initializedAt=2026-10-12T10:36:45.710Z, entries=0, writes=false`。已有私有 Blob 的 `recovery/verlark-media-v1/` 基线现已启用；没有写音频或删除业务数据。
- 将维护规则改为 `issue18-legacy-deployments`：拒绝下列名单之外的 Hostname。没有关闭 Vercel Authentication 或建立绕过令牌。
  - `articu-lab.vercel.app`：正式入口。
  - `verlark-7fhctviak-p396500554-3359s-projects.vercel.app`：本次新生产部署。
  - `verlark-git-integrate-issues-20-21-p396500554-3359s-projects.vercel.app`：既有独立数据库邮件验收入口；已核对与生产库不同。
- 恢复后生产首页 200；带既有维护密钥的只读日检 200，录音 due/pending 和材料 pending 均为 0，scanOverdue/cleanupOverdue/attentionRequired 均为 false。扫描时间仍为 15:42:01.293 的手动运行，没有伪造自然 cron 证据。
- 既有生产会话刷新后仍可进入版本 2 的练习页面；“从头重听”后播放器 `duration=12.1, currentTime=12.1, ended=true, error=null`。独立邮件 Preview 恢复登录页面；旧生产部署 `verlark-7qgdb4f7x-p396500554-3359s-projects.vercel.app` 在已登录浏览器中仍为 403。
- 切换前对确切恢复代码重跑日志和配置测试，2 个文件 11 项通过；首次运行因依赖软链接指向只读工作树而未启动，改用当前工作区依赖后通过。部署构建成功；未把重复测试扩大为新增完整实机验收。

## 实机测试准备

18:41 左右核对既有 Blob：Private、Available，控制台显示存储 387 kB，平均存储 321 kB / 1 GB、Simple Operations 60 / 10k、Advanced Operations 24 / 2k、Data Transfer 6 MB / 10 GB。这是当时仪表盘读数，可能有统计延迟，不是账单永久为零的保证。

在生产配置中将 `RECORDING_UPLOADS_ENABLED` 从 `false` 改为 `true`，用途为现有测试名单的设备验收；Preview 的关闭值未改，认证保护与测试名单未扩大。只录不含隐私的短测试句；没有启用真实识别或反馈。供应商清理边界仍未确认，删除后必须如实保留清理未完成状态。配置需要新部署才生效，设备实测结果另行记录。

同一提交 `714d4bf` 的新生产部署 `BSrtbQ3MzZtaPtYozqZg9p4jo8Pf` 于 18:44:53 Ready，正式域名已绑定，上传配置随该部署生效。18:45:30 对正式域名执行一次 `check-media-maintenance.ts --run`，录音与材料维护扫描成功，随后状态 due/pending/materials.pending 均为 0，三个告警标志均为 false；这是人工触发，不计作自然 cron。没有借此次扫描删除未到期文件。

最终入口名单将上述初次生产部署地址替换为 `verlark-bgkt0pk0w-p396500554-3359s-projects.vercel.app`；正式域名和独立邮件 Preview 入口不变。直接部署地址只用于当前版本诊断，后续部署必须同步维护该名单。

## 持续运行限制

恢复日志初始化后，不可将生产回退到没有日志写入的旧代码。新预览入口如需访问，必须先确认代码含日志写入或使用独立数据库，再更新入口名单；不要为方便测试移除旧部署隔离。任何别名重新绑定到旧代码也会破坏保障，部署操作需要保持此边界。

本机旧服务仍关闭。恢复本机开发前，应合入恢复日志实现，或改用独立开发库；单独设置旧代码不认识的开关不构成隔离。

仍需补齐：供应商在途／分段清理及免费层停用后的管理删除保障；真实录音提交、历史回放与删除的设备验收；自然 cron 和持续日检／监控。初始化空基线和已有隔离恢复演练不能代替真实录音的运行验证。当前没有宣布物理清理完成，没有关闭 #18。
