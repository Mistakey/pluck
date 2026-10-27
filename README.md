# Pluck

自用、精简的 AI 编程工具配置管理软件。

集中处理 Claude Code 的官方订阅与 CPA 使用方式切换，以及 Skill 的按工具管理，减少手动配置和重复维护。

## 已确认的目标

- 支持 Claude Code 在官方订阅和 CPA 之间切换。官方订阅继续通过 Claude Code 原生官方登录使用，不接入 CPA。
- 集中管理 Skill，按工具选择共享或专属内容，避免工具互相看到对方的专属 Skill。
- 提供托盘入口，以及当前模式和模型信息等基础状态展示。
- 保持功能精简，以个人实际使用需求为依据扩展。

## 使用背景

- 当前使用 CPA Plus 管理其他接入，Claude Code 同时存在官方订阅和 CPA 两种使用需求。
- 现有 Skill 通过 junction 等方式合并目录，出现不同工具互相看到专属 Skill 的问题。
- 当前使用 Token Monitor，通过 Hub 汇总不同电脑的 Token 用量。

## 项目状态

已完成首版设计与 Forge 项目关联，尚未开始应用实现。首版先交付 Windows 上的 Claude Code CLI 配置管理：官方订阅与 CPA 切换、CPA 模型列表接入原生 `/model` 菜单，以及配置窗口和托盘入口。

采用 Tauri 2、Rust、React 和 TypeScript；Windows 是首个交付平台，不是项目永久的平台限制。首版规格关联 Forge 任务 `pluck-ehl`，任务状态由 Forge 维护。

项目术语见 [GLOSSARY.md](GLOSSARY.md)，选型与配置管理理由见 [技术栈决策](docs/adr/0001-desktop-stack.md) 和 [原生配置决策](docs/adr/0002-native-config-and-saved-changes.md)，外部实现依据见 [CC Switch 与 Magpie 对照](docs/upstream/cc-switch-and-magpie.md)。

后续候选见 [ROADMAP.md](ROADMAP.md)。候选不代表已承诺实现。
