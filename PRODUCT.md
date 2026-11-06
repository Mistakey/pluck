# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Tauri 2 桌面应用，界面运行在 WebView 中。Windows 是首个交付平台，不是永久的平台限制（见 [ADR 0001](docs/adr/0001-desktop-stack.md)）。

## Users

只有作者本人：开发者，同时使用 Claude Code 的官方订阅和 CPA（自建 API 接入服务，上游由 CPA Plus 管理）。平时经常在两种使用方式之间切换，并调整 CLI 里可选的模型。

## Product Purpose

集中管理 AI 编程工具的配置，减少手动修改和重复维护。

- 已交付：在 Claude Code 的官方订阅与 CPA 之间切换；从 CPA 获取模型列表，加入 CLI 原生的 `/model` 菜单，并设置默认、子代理、自动审批和别名模型；通过配置窗口和托盘查看状态、切换模式。
- 下一阶段：Skill 集中管理。按工具选择共享或专属内容，避免工具互相看到对方的专属 Skill。
- 后续候选见 [ROADMAP.md](ROADMAP.md)，候选不代表已承诺实现。

成功的标准是：切换和调整都在 Pluck 里完成，不再手改配置文件；改动生效的方式和范围始终清楚。

## Positioning

Pluck 只管理 Claude Code 自身支持的原生配置，不另造一层：

- 只改用户级 `settings.json` 中 Pluck 负责的连接和模型字段，其余设置保持文件中的实时值。
- 不读写官方登录凭据，不修改项目级设置。
- 官方模式继续使用 Claude Code 的原生登录，不接入 CPA。

## Operating Context

- 常驻托盘：左键打开配置窗口，右键查看状态、切换模式或退出。窗口关闭后释放 WebView。
- 改完配置后，需要重新打开 Claude Code CLI 才完整生效。项目级设置、启动参数和环境变量按原生规则优先。
- 配置文件可能同时被 CLI（例如 `/model` 保存）或其他程序修改；Pluck 需要与这些外部修改协调。

## Capabilities and Constraints

- 配置无法解析、文件只读或被占用、读取后被他人修改，或者连接字段不属于官方也不属于已保存的 CPA 时，拒绝写入并说明原因，原文件保持不变。
- 编辑期间发生外部修改时保留草稿并提示，不能用旧草稿覆盖新配置。
- 未保存的修改在切换模式、关闭窗口、更新前都要明确处理：保存、放弃或继续编辑。
- 应用内更新使用 Tauri 签名校验；只有用户点击才下载。
- 术语以 [GLOSSARY.md](GLOSSARY.md) 为准（官方模式、CPA 模式、原生配置、用户级配置、模型 ID、原生模型菜单、原生别名、子代理）。
- 未决定：Skill 管理的具体形态；用量统计是否属于 Pluck（见 ROADMAP）。

## Brand Commitments

只有名字 Pluck。没有固定的视觉风格偏好：以好用、好看为准，界面风格可以随时演进。

## Evidence on Hand

- 产品说明与使用方式：[README.md](README.md)
- 决策记录：[docs/adr/](docs/adr/)
- 验证记录：[docs/verification/](docs/verification/)，包括 CLI 原生菜单兼容、真实安装与升级、资源测量
- 没有用户评价、外部用户或使用数据；以后的工作不要编造这类内容。

## Product Principles

1. **原生配置优先。** 使用 Claude Code 自身支持的配置项，不另建一套机制。
2. **只改自己负责的部分。** 写入范围明确、可说明；不负责的设置一律保持原样。
3. **绝不丢失用户输入。** 冲突、失败和外部修改都保留草稿，由用户明确决定。
4. **按实际需要扩展。** 功能保持精简，以作者的真实使用需求为依据。
5. **好用优先。** 高频操作要快：键盘可达，状态一眼可见，提示直接说清做了什么。
