# Pluck

Pluck 是个人使用的 AI 编程工具配置管理软件。

## 术语

**官方模式**：Claude Code 使用自身原生登录及官方订阅的一组连接和模型配置。

**CPA 模式**：Claude Code 使用用户现有 CPA 服务的一组连接和模型配置。

**CPA**：用户现有的 API 接入服务，其上游接入由 CPA Plus 管理。CPA 提供的模型可能使用任意模型 ID。

**原生配置**：Claude Code 自身支持并读取的配置，包括设置文件和子代理定义中的配置项。

**用户级配置**：属于当前用户、作用于本机各项目的 Claude Code 配置；独立于项目级配置。

**模型 ID**：模型服务实际识别的模型名称，可以与界面上的显示名不同。

**原生模型菜单**：Claude Code CLI 的 `/model` 选择菜单。`modelPicker` 是定义该菜单可选项的原生配置项。

**原生别名**：Claude Code 中的 Sonnet、Opus、Haiku 等模型别名，可以通过原生配置对应到服务提供的实际模型 ID。

**子代理**：Claude Code 为独立处理一部分工作而启动的 AI 执行单元，模型选择遵循 Claude Code 的原生规则。
