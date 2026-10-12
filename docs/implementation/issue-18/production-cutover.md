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

## 首次真实录音核验

用户反馈已完成录音、试听和提交。生产库确认于 2026-10-12 19:17:05.493（Asia/Shanghai）接收一条作答：`audio/webm`、77,681 bytes、上报时长 4,800 ms，录音未封存、无清理错误，识别状态为 `pending-identification`。当前未接入识别服务，此状态不代表上传失败。

独立读取私有 Blob 恢复日志，基线时间不变，条目数由 0 变为 1。对应 upload 条目的录音 ID、学习者归属、练习归属、临时路径、最终路径、请求媒体类型、创建时间及凭据到期时间均与生产库一致；该练习尚无删除标记。记录中不公开学习者标识或音频存储路径。

在已有桌面 Chrome 会话刷新练习页，页面保留“作答 1／已接收 · 待识别”。通过“回放作答 1”播放器播放，最终 `duration=4.74, currentTime=4.74, ended=true, error=null`。这确认服务端历史录音能在桌面回放，不能替代手机刷新后的实测；浏览器解码时长与客户端上报时长分别记录，不混为同一测量。

仍等待用户确认手机刷新后回放，并由用户操作删除以验证删除标记与访问撤销。尚未执行删除，也未宣称物理清理完成。设备系统／浏览器版本与本次网络条件未补充确认。

## 用户反馈后的删除核对

用户随后反馈“成功啦，继续”。19:27 的生产核对发现，19:26:08.112 删除的是另一条练习，其录音清单数量为 0；恢复日志新增 deletion 条目，删除时间与业务库一致。日志共 2 条（1 upload、1 deletion），但两条属于不同练习。包含上述 4.8 秒录音的原练习仍未删除，作答仍存在、录音未封存。因此不能把这次成功反馈记作真实录音删除验收通过，需针对原练习继续操作。

只读维护检查 HTTP 200，due/pending/materials.pending 为 0，告警均为 false；最后扫描仍为 18:45:30.709 的人工运行，未取得自然 cron 的新证据。没有为制造通过结果而改动生产数据或删除用户录音。

## 持续运行限制

恢复日志初始化后，不可将生产回退到没有日志写入的旧代码。新预览入口如需访问，必须先确认代码含日志写入或使用独立数据库，再更新入口名单；不要为方便测试移除旧部署隔离。任何别名重新绑定到旧代码也会破坏保障，部署操作需要保持此边界。

本机旧服务仍关闭。恢复本机开发前，应合入恢复日志实现，或改用独立开发库；单独设置旧代码不认识的开关不构成隔离。

仍需补齐：供应商在途／分段清理及免费层停用后的管理删除保障；手机刷新后的历史回放与删除验收（录音提交及桌面回放已核验）；自然 cron 和持续日检／监控。初始化空基线和已有隔离恢复演练不能代替真实录音的运行验证。当前没有宣布物理清理完成，没有关闭 #18。
