# Domain Docs

本项目采用 single-context：根目录 `GLOSSARY.md` 定义统一领域术语，`docs/adr/` 保存架构决策。identity、learning-content、practice 是同一领域下的业务模块，不因此拆分词汇表。

## 探索与实施前读取

1. 阅读根目录 `GLOSSARY.md`，按其中定义使用领域术语。
2. 阅读 `docs/adr/` 中与当前工作相关的 ADR，遵守已接受的决定。
3. 涉及练习、作答、确认文本、反馈或历史规则时，阅读 `docs/domain-model.md`。
4. 涉及产品范围时，阅读 `docs/refactoring-design.md`；涉及模块边界与技术设计时，阅读 `docs/architecture-proposal.md`。
5. 实施首版或拆分任务时，阅读 `docs/first-release-spec.md` 与 `docs/implementation-plan.md`，分别核对验收条件与阶段顺序。

词汇表或 ADR 尚未存在时继续工作，不为满足目录布局预先创建空文档；只有术语或决定实际形成后才由 domain-modeling 工作流补齐。

## 术语与决定的使用

在 issue、规格、测试和实现中使用词汇表定义的名称，避免被明确排除的近义词。新概念缺少术语时，先判断是否已有对应概念；确有缺口再记录供领域建模处理。

若方案与已接受 ADR 冲突，明确指出冲突、原因及影响，不能悄悄覆盖。候选研究、旧 README 或历史 QA 不覆盖后续已接受的决定；具体变更需同步相关领域文档和验收规格。

确认设计不等于已实现或已验证。供应商、音频存储及保留规则、预算和部署地区等延后事项，以已确认文档所列边界为准，不能在实施中暗中定案。
