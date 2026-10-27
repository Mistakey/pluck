# CLI 隔离验证报告

- 时间：2026-10-27T11:58:41.424Z
- 操作系统：Windows 11 Pro 10.0.26200
- Claude Code：2.1.311 (Claude Code)
- 结果：32/32 通过

| 验收 | 检查 | 结果 | 说明 |
| --- | --- | --- | --- |
| A2 | 保存 CPA 连接，状态只显示 Key 尾号 | 通过 |  |
| A3 | 从 CPA 获取到非 Claude 命名的模型 | 通过 | gpt-5.1-codex, qwen3-coder-plus, deepseek-v3.2 |
| A3/A6 | CPA error 时报错并保留原列表与配置 | 通过 | CPA 模型列表获取失败，已保留原列表：HTTP 500 Internal Server Error：{"error":"upstream unavailable"} |
| A3/A6 | CPA invalid 时报错并保留原列表与配置 | 通过 | CPA 模型列表获取失败，已保留原列表：响应不是有效 JSON：expected value at line 1 column 1 |
| A3/A6 | CPA empty 时报错并保留原列表与配置 | 通过 | CPA 模型列表获取失败，已保留原列表：CPA 返回了空列表 |
| A3/A6 | Key 错误时报错并保留原列表 | 通过 | CPA 模型列表获取失败，已保留原列表：HTTP 401 Unauthorized：{"error":{"type":"authentication_error","message":"invalid key"}} |
| A4 | 官方模式下保存 CPA 模型配置不改动用户文件 | 通过 |  |
| A2/A4 | 切到 CPA 写入连接、菜单、默认/子代理/别名 | 通过 |  |
| A7 | 切换结果提示重开 CLI 及项目/启动覆盖 | 通过 |  |
| A6 | 写回后保留 CRLF 换行 | 通过 |  |
| A3 | CLI /model 菜单显示 CPA 模型（实际 ID 与显示名） | 通过 |  |
| A3 | 替换内置菜单后不显示 Claude 系列行 | 通过 |  |
| A3/A5 | CLI 以实际 ID 保存默认模型 Y | 通过 | qwen3-coder-plus |
| A3 | CLI 请求使用实际模型 ID | 通过 | qwen3-coder-plus |
| A5 | 会话临时选择在当前会话中生效 | 通过 | deepseek-v3.2 |
| A5 | 会话临时选择不改动已保存的默认模型 | 通过 | qwen3-coder-plus / qwen3-coder-plus |
| A2/A5 | 切回官方：CPA 连接与模型覆盖不带回 | 通过 |  |
| A5 | 官方模式恢复自己的最新已保存模型 | 通过 | opus |
| A5 | 其他设置与后来新增字段保持 | 通过 |  |
| A2 | 官方登录凭据文件不变 | 通过 |  |
| A5 | 再切回 CPA 仍为 CLI 保存的 Y | 通过 | qwen3-coder-plus |
| A5 | 往返后 CLI 新会话使用 Y | 通过 | qwen3-coder-plus |
| A1/A5 | 重开后读回模式、CPA、模型与列表 | 通过 |  |
| A7 | 项目级 model 覆盖用户级默认 | 通过 | deepseek-v3.2 |
| A7 | 启动参数 --model 覆盖用户级默认 | 通过 | gpt-5.1-codex |
| A7 | 切换不改写项目级设置 | 通过 |  |
| A4 | 取消子代理默认与别名后移除对应原生配置 | 通过 |  |
| A6 | 损坏的 settings.json 拒绝切换且不被覆盖 | 通过 | C:\Users\33137\AppData\Local\Temp\pluck-verify-J2v08O\claude\settings.json 无法解析，已停止写入以免覆盖原有设置：EOF while parsing a value at line 1 column 21 |
| A6 | 损坏时状态显示为无法读取 | 通过 |  |
| A6 | 恢复文件后可继续读取 | 通过 |  |
| A2 | 全程官方凭据文件不变 | 通过 |  |
| D3 | Key 只保存在本机数据和 CPA 模式的用户配置中 | 通过 |  |
