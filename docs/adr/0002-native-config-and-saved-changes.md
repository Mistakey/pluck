# 管理原生配置并保留 CLI 保存的修改

> Source: pluck-ehl (D2–D6)

Pluck 的核心是为 Claude Code 原生配置提供获取、选择、保存和切换界面。官方与 CPA 分别保留最新已保存的连接和模型配置；切走前读取用户级配置，把 CLI 中保存的修改纳入当前模式，再应用目标模式的配置。更新以实时文件为底，只处理管理范围内的字段，其他用户设置继续保留，官方登录由 Claude Code 自身管理。

CPA 当前没有 Claude 系列模型，未来模型名称也不确定，因此模型 ID 以 CPA 实际返回值为准。Pluck 获取列表后配置原生模型菜单，让用户在 CLI 中直接找到和切换模型；默认模型、子代理默认模型及别名映射提供对应原生配置的控件。子代理的创建、调度与配置优先级继续遵循 Claude Code。

## 考虑过的方案

- 每次切换恢复 Pluck 中的固定预设：与用户选择的“保留 CLI 最新已保存修改”不符；CC Switch 当前直连实现采用的预设应用行为可作对照。
- 保存并恢复整份旧设置文件：会覆盖 CLI 或用户后来添加的无关设置，故以字段范围隔离和实时文件为基础。
- 依赖 Claude Code 自动发现 CPA 的所有模型：原生自动发现对模型 ID 有筛选规则，不能覆盖当前的非 Claude 模型需求，故由 Pluck 获取列表并配置原生模型菜单。
- 只允许全局统一使用一个模型：过早收窄原生配置能力；通过原生配置提供选择即可。

参考实现和差异统一记录于 [CC Switch 与 Magpie 对照](../upstream/cc-switch-and-magpie.md)。原生行为依据：[模型菜单配置](https://code.claude.com/docs/en/settings-reference#modelpicker)、[子代理模型规则](https://code.claude.com/docs/en/sub-agents#choose-a-model)。
