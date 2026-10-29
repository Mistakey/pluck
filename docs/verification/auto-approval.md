# 自动审批模型兼容说明

Pluck 的 CPA 模型用途中可选择自动审批模型。选择与清空走现有保存、草稿、冲突检查流程；官方与 CPA 各自保留审批字段。官方值来自 Claude 用户配置，CPA 值可在 Pluck 编辑。未指定表示使用 CLI 原生审批默认，不表示跟随主模型。界面显示模型名称，配置和请求使用完整 ID。

没有更改 `state.json` 格式。旧版快照没有审批字段时，恢复该快照会移除实时文件中的审批字段；离开当前模式前仍会保存实时值。旧版没有记录下来的其他模式历史值无法恢复。无关字段、原生模型字段和官方凭据按现有规则保留。

## CLI 支持条件

根据 2026-10-29 的[官方权限模式文档](https://code.claude.com/docs/en/permission-modes#choose-the-classifier-model)及[环境变量文档](https://code.claude.com/docs/en/env-vars)，Claude Code 2.1.302+ 支持用户 `settings.json` 的 `env.CLAUDE_CODE_AUTO_MODE_MODEL`。本次使用本机 2.1.312。

- 必须实际进入 auto 权限模式；`-p` 需要明确传 `--permission-mode auto`。设置 `disableAutoMode`、模型不支持或服务端禁用时可能进入 Manual；写入模型字段不启用 auto。
- Anthropic 配置的 classifier model 优先于此字段。组织策略拒绝的模型，以及 CLI 不接受作为 classifier 的 Claude Opus 5、Sonnet 5.5、Opus 5.5 会被忽略并使用默认模型。提供方无法提供所选模型时，审批可能失败并拒绝动作。
- 服务端审批启用时，由服务端随主请求审查，不调用用户选择的本地 classifier 模型。CLI `/status` 的 `Auto mode server` 显示 `Enabled` 可识别此路径。该行为来自官方文档，本次未连接官方服务做账户级验证。
- 替身不返回服务端 verdict 时，本次 CLI 日志确认 `server_no_result` 后退回本地 classifier；此后 `classifier_request_started` 的 `model=` 与替身收到的模型对应。默认 Claude 模型 ID 仍可经 CPA 请求，不能把 ID 当作网络去向或费用证据。
- 使用其他模型时，搜索调试日志中的 `ignoring CLAUDE_CODE_AUTO_MODE_MODEL` 查明原因。没有本地 classifier 日志时应结合权限模式及服务端审批状态判断，不能宣称选定模型已经生效。

服务端审批与代理的边界参见[官方审批计费说明](https://code.claude.com/docs/en/auto-mode-classifier-billing)。Pluck 不修改服务端审批开关或绕过 CLI 审批规则。

## 自动验证

`pnpm verify:cli --report docs/verification/cli-compatibility.md` 使用独立 Claude 配置、Pluck 数据、工作目录、PTY 和动态端口的 CPA 替身；启动 CLI 前清除继承的 `CLAUDE*` / `ANTHROPIC*` 环境变量。不访问真实凭据或付费服务。自动审批阶段禁用遥测及无关模型调用。

替身主模型发出一个向本地替身 POST 的 Bash 工具调用；CLI 必须发起真实 classifier 请求、解析替身审批响应，然后实际执行 POST。脚本同时核对 classifier 调试日志中的模型、替身收到的模型、鉴权和执行证据。选定模型、未指定默认和不支持模型的忽略路径均检查。具体模型和脱敏证据由脚本写入[CLI 验证记录](cli-compatibility.md)。该验证证明配置及请求路由，不评价模型自身的审批质量。

Rust 服务测试覆盖官方/CPA 多次往返、官方新值恢复、旧版固定数据、审批字段单独变化引起的实时/快照冲突、清空和凭据保留。无头生产 UI 检查覆盖审批选择器的显示名/列表外值、完整 ID 保存、独立草稿、刷新保留、冲突拒绝与清空。

本次 `pnpm build` 通过；`pnpm test:rust` 30 项通过；`pnpm verify:ui` 29 项通过（2026-10-29，Edge 156.0.4314.50，生产构建）。1040×688 与 840×544 布局检查通过，已查看生成截图确认新控件与固定保存区布局。未自动操作用户桌面。
