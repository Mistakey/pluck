# CC Switch 与 Magpie 参考对照

本记录核对于 2026-10-27，仅记录外部实现和本项目取舍的依据。参考版本：

- CC Switch：`e55d8a21b3897b595b746e9f2139716b2931641d`。
- Magpie：`5e3dd1d52213a838ff4253b9de65bf16eb3d553e`。

这些结论来自源码、文档和已有测试的阅读；没有在本机执行参考项目的测试。Pluck 的决策见 [ADR 0001](../adr/0001-desktop-stack.md) 和 [ADR 0002](../adr/0002-native-config-and-saved-changes.md)。

## 模型获取、界面和原生菜单

CC Switch 的普通直连表单自己请求服务的模型列表，供下拉输入使用，再将选择保存为供应商的默认模型、各档位或子代理模型配置。这条表单路径不自动把整个列表发布到原生模型菜单；其 Stack 聚合路径另外生成 `modelPicker`。底层仍能应用供应商配置中已有的该字段。

- [直连表单获取列表](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src/components/providers/forms/ClaudeFormFields.tsx#L303-L350)
- [直连模型字段和下拉输入](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src/components/providers/forms/ClaudeFormFields.tsx#L602-L669)
- [服务端模型列表请求](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/commands/model_fetch.rs#L177-L207)
- [Stack 原生菜单生成](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/mode/controller.rs#L217-L241)

Magpie 在接管到自身服务时，将维护的模型列表写成包含实际模型 ID、显示名和说明的 `modelPicker`，使模型出现在 CLI 菜单中。它尊重用户自己设置的菜单；模型同步和退出时辨别哪些菜单配置属于自己。

- [Magpie 菜单生成和归属判断](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/agent/claude.go#L935-L1002)
- [Magpie 子代理模型控件对应的原生配置写入](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/agent/claude.go#L1833-L1890)

Claude Code 原生 `modelPicker` 自 v2.1.242 起支持完整菜单配置，每行模型 ID 原样使用，显示名独立；本次调查时本机版本为 2.1.311。原生自动发现是另一条生成菜单的路径：Claude Code 读取服务端 `/v1/models` 的响应后，只保留 ID 中含 `claude` 或 `anthropic` 的项。筛选发生在 Claude Code 客户端，不是 CPA 服务端，也不等于不能通过 `modelPicker` 配置其他模型 ID。

- [官方 modelPicker 说明](https://code.claude.com/docs/en/settings-reference#modelpicker)
- [官方自动发现规则](https://code.claude.com/docs/en/llm-gateway-protocol#model-discovery)

## 保存与恢复的语义

CC Switch 当前直连切换不把实时文件回填到原供应商预设；切换应用目标供应商已保存的配置。测试明确要求上一家通过 CLI 保存的顶层模型选择不跟到下一家。这与 Pluck 保留每种模式最新 CLI 修改的选择存在差异。

- [直连切换入口](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/services/provider/claude_direct.rs#L1-L80)
- [CLI 模型选择的切换测试](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/tests/golden/claude_key_fields.rs#L105-L116)

Magpie 保存接管前配置：Disconnect 恢复接管前模型，`model default` 则恢复原连接和模型环境变量但清除顶层模型选择。原连接可能仍是第三方服务，所以不能把“退出接管”直接解释成“切回官方”。

- [接管前配置保存](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/agent/claude.go#L1446-L1476)
- [Disconnect 与 default 的回归对照](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/agent/disconnect_test.go#L87-L190)
- [历史端点与快照丢失的修复](https://github.com/yetone/magpie/commit/fe2603ff4f3d7d64244a0317538081a81eade61e)

官方文档说明：CPA 使用的凭据变量可覆盖已保存的官方登录，官方登录本身仍保留；删除覆盖后可继续使用原生登录。无需通过管理登录凭据文件实现这种配置切换。

- [官方登录与服务端凭据的关系](https://code.claude.com/docs/en/llm-gateway-connect#conflicts-with-an-existing-login)

## 已有设置与写入失败

CC Switch 历史上出现整份覆盖导致 hooks、插件、权限等设置丢失的报告。当前实现以实时文件为底，仅替换连接、鉴权、模型等字段，并有往返保留测试；历史报告不能当成当前版本仍有同一缺陷的证明。

- [历史问题 #1656](https://github.com/farion1231/cc-switch/issues/1656)
- [当前字段级更新实现](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/live/project/claude.rs#L83-L112)
- [往返保留测试](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/tests/provider_service.rs#L2530-L2605)
- [损坏配置拒写测试](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/live/engine.rs#L244-L257)
- [Windows 文件占用时旧文件保持不变](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/src/config.rs#L755-L775)

Magpie 的测试还覆盖旧模型档位、子代理模型、显示元数据的保存恢复，以及磁盘同步失败时保留旧文件。这些是配置管理值得采用的测试场景，不能据此照搬其完整接管机制。

- [模型配置恢复输入](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/agent/disconnect_test.go#L95-L107)
- [模型显示元数据问题 #1227](https://github.com/yetone/magpie/issues/1227)
- [磁盘同步失败回归](https://github.com/yetone/magpie/blob/5e3dd1d52213a838ff4253b9de65bf16eb3d553e/internal/edit/sync_1505_test.go#L12-L29)

## 配置生效时机与覆盖范围

Claude Code 会把设置文件中新增或变化的环境变量应用到运行中的会话，但删除变量不会清除运行中进程已持有的值，需要重开后生效。因此“管理新开 CLI 的默认配置”不能解释为“旧会话完全不受影响”。项目配置、启动参数等也可能覆盖用户级默认；Pluck 展示的全局配置状态不能证明所有运行中实例都已切换。

- [官方环境变量生效说明](https://code.claude.com/docs/en/env-vars#set-variables-in-settings-files)
- [官方配置优先级](https://code.claude.com/docs/en/settings#settings-precedence)
