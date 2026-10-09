# 先听后用 UI 原型

本目录是可丢弃的设计原型，不是第二阶段业务实现。五个结构方案回答：学习者怎样在听材料、查看帮助、表达自己、核对转写和查看反馈之间移动最清楚？

## 运行与入口

```sh
pnpm prototype
```

打开 `http://127.0.0.1:3100/prototype?variant=A`。若项目已经启动 `pnpm dev`，直接使用该服务的 `/prototype?variant=A`，不要重复运行 Next 开发服务。

- `A` 练习书桌：侧栏导航，中央任务，右侧按需帮助和作答记录。
- `B` 专注练习：顶部导航，单列任务，帮助在任务下方。
- `C` 听说对照：目录先选择再预览；练习时材料与表达工作区左右并排，手机改为上下顺序。
- `D` 情境电台：横向切换话题、场景封面与预听播放器，练习帮助与作答记录放在按需打开的抽屉中。
- `E` 练习手册：按表达任务浏览目录，练习时使用纵向步骤导航、中央练习页和右侧参考笔记；手机将步骤排成横向。

底部箭头或键盘左右键切换。输入框、按钮、播放器等控件中不截获方向键。URL 可分享和刷新恢复布局；学习记录、展开状态、草稿仅保留在内存，刷新重置。右下角状态按钮显示完整示例状态，并可选择识别失败、反馈失败场景。每次状态变化也打印到浏览器控制台。

原型路由在 `NODE_ENV=production` 时返回 404；切换条也单独受开发环境条件保护。没有修改正式首页、认证页面、数据库或服务供应商配置。

## 依据与范围

规格依据：根目录 GLOSSARY.md、docs/domain-model.md、docs/first-release-spec.md、docs/refactoring-design.md、docs/architecture-proposal.md、docs/implementation-plan.md，以及 GitHub Issues #7、#16。较旧品牌文件中的写作、发音评估等范围不进入本原型。

沿用品牌资产的形状与 Manrope 字体。Paper/Ink/Ember 颜色按现有品牌延伸；小号文字使用更深的 Ember 以满足对比度。DESIGN_VARIANCE=5，MOTION_INTENSITY=3，VISUAL_DENSITY=4。现有 shadcn/Radix 组件与 lucide 图标保持一致；原型独立 CSS 不代表新组件库。

包含六类示例主题、可播放的本地合成音频、原文/释义、分级帮助、模拟录音草稿、试听、丢弃、提交、核对文本、固定示例反馈、再次作答、结束、记录、继续、重练、删除确认、空状态与失败恢复。反馈演示表达清楚、零纠错项的合法情况；可选替代表达不会标为错误。

关键区分：

- 提交前的录音草稿不是作答；重试识别不新增作答。
- 更正并确认新文本时创建新版本，旧反馈仍保留原依据。
- 至少一份当前有效反馈、且没有处理中的请求时才能结束。
- 一次作答有效、另一作答失败时可以结束；失败不会变为成功。
- 已结束记录只读；重练创建新的练习。

不模拟登录身份、权限、持久化、服务端并发、真实录音/识别/模型反馈、内容发布/撤下和音频清理规则。不能把这些 UI 演示作为对应业务 Issue 的完成依据。内容未经正式审核，固定反馈不是输入文本的分析。

## 设计结论

五套结构已形成可比较原型。建议优先试用 A：帮助和作答记录位置固定，适合来回参考；B 更专注但帮助距离较远；C 更适合桌面回听对照，手机需要更长的滚动；D 减少常驻辅助信息，但查阅作答需打开抽屉；E 的步骤位置更明确，代价是桌面占用更多横向空间。此为设计判断，不是用户验证结果。目前没有胜出方案，不将任何方案提升到正式页面。

保存在本地分支 `prototype/listen-then-use-ui`，不合并主分支。原工作区已有无关修改和两个未推送提交；本次提交只包含原型目录、静态资源及启动脚本，不包含它们，也不推送整个现有分支历史。

## 资产来源

- Logo：从 `brand/verlark/exports/` 原样复制，未改形。
- 字体：现有 Manrope 本地字体，OFL 许可随文件复制。
- 音频：macOS 本地 Samantha 语音，语速 145，WAVE/LEI16/22050Hz，内容来自 fixtures.ts。供交互验证，不是已审核教学录音。
- 场景图：内置 imagegen 生成，保存在 `public/prototype/weekend-cafe.png`，没有使用 API/CLI 回退。

图像提示词：

> Create one editorial photograph for an adult English speaking practice app, used as the cover of the listening material 'Weekend plans'. Wide landscape composition 3:2. A quiet sunlit contemporary neighbourhood cafe, two empty red-orange chairs around a small round brushed steel table with two cups of coffee, a paperback book, tree shadows and blurred leafy garden beyond. Human feeling without people. Refined analogue photography, soft natural late morning light, subtle film grain, warm neutral plaster and terracotta red accent, muted olive foliage, candid real place, not a luxury product ad. Main table in lower right with beautiful balanced environment. No text, no lettering, no logos, no frames, no UI. Generate high-quality photographic asset, not a website screenshot.

## 检查记录（2026-10-09）

已运行类型检查、原型目录 ESLint、Prettier。Webpack 生产构建通过；默认 Turbopack 构建因本机编译端口权限错误未通过，提升权限重跑仍复现。没有更改默认构建配置。浏览器手动走查：选材、默认隐藏原文、按需帮助、草稿不计作答、提交核对、反馈、切换保留状态、修改文本后反馈失败、恢复生成、再次作答识别失败、混合状态结束、已结束禁止重试、重练、搜索空状态、草稿离开确认、删除及空记录；检查三种布局及明暗主题，手机 390×844 视口无横向溢出。

Chrome 既有翻译/语法扩展向 html/body 注入属性，触发一次 hydration 提示；内置浏览器不含这些注入。未为掩盖扩展提示修改正式根布局。

这不是生产性能、真实设备录音或学习效果验收。没有新增自动测试或运行外部服务验收。

对比度检查：浅色正文 13.47:1、辅助文字 4.92:1、主按钮 5.23:1；深色正文 13.90:1、辅助文字 7.82:1、主按钮 4.68:1。未运行 Lighthouse，不报告生产性能指标。

## D / E 增补检查

保留 A/B/C，新增 D 情境电台、E 练习手册，总计五种。复用同一套示例内容、明暗主题和内存状态，不扩展产品功能范围。切换列表统一按实际方案数量循环，已浏览器核对 E → A、A → E。

浏览器走查 E 选材、模拟录音、提交，切到 D 后保留同一次作答；验证帮助抽屉展开关键词和完整示例、关闭后确认文本生成反馈，再切 E 保留反馈。检查桌面布局、390×844 手机布局、深色模式与抽屉，无横向溢出。类型、原型目录 lint、格式检查和 Webpack 生产构建通过。
