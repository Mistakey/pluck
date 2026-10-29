# CLI 原生配置兼容验证

时间：2026-10-29T06:56:35.973Z；CLI：2.1.312 (Claude Code)。独立配置和 PTY，不操作用户桌面。

- 通过：原生模型菜单显示 CPA 的实际 ID 与显示名
- 通过：原生菜单接受替换内置选项的配置
- 通过：CLI 以实际 ID 保存所选模型
- 通过：官方审批模型恢复自己的配置
- 通过：CPA 审批模型恢复自己的完整 ID
- 通过：往返保留未管理字段和官方凭据
- 通过：往返切换保留 CLI 保存的选择
- 通过：新会话请求使用实际模型 ID
- 通过：selected：真实自动审批已完成，日志模型与 CPA 实收模型一致
- 通过：选定 CPA 审批模型实际生效
- 通过：default：真实自动审批已完成，日志模型与 CPA 实收模型一致
- 通过：ignored：真实自动审批已完成，日志模型与 CPA 实收模型一致
- 通过：CLI 对不支持的审批模型给出忽略原因并使用默认

2026-10-29T06:56:04.810Z [DEBUG] [server-classifier] the platform gave no classification for this request (server_no_result); treating that as this deployment's answer: auto mode classifies locally for the rest of this session and stops sending the classifier context

自动审批 selected：qwen3-coder-plus；请求到达本地 CPA 替身，审批后执行了本地 POST。
```text
2026-10-29T06:56:04.815Z [INFO] [Stall] classifier_request_started reqId=<isolated> tool=Bash model=qwen3-coder-plus stage=xml_s1 promptTokensEst=[REDACTED]
{"path":"/v1/messages","model":"qwen3-coder-plus","auth":true}
```

2026-10-29T06:56:17.772Z [DEBUG] [server-classifier] the platform gave no classification for this request (server_no_result); treating that as this deployment's answer: auto mode classifies locally for the rest of this session and stops sending the classifier context

自动审批 default：claude-sonnet-5；请求到达本地 CPA 替身，审批后执行了本地 POST。
```text
2026-10-29T06:56:17.778Z [INFO] [Stall] classifier_request_started reqId=<isolated> tool=Bash model=claude-sonnet-5 stage=xml_s1 promptTokensEst=[REDACTED]
{"path":"/v1/messages","model":"claude-sonnet-5","auth":true}
```

2026-10-29T06:56:26.271Z [WARN] Auto mode classifier: ignoring CLAUDE_CODE_AUTO_MODE_MODEL=claude-opus-5 because the API's safeguards refuse the classifier's escalated check on it; using the default classifier model instead. Unset it or pin a different model, such as claude-sonnet-5.
2026-10-29T06:56:28.561Z [DEBUG] [server-classifier] the platform gave no classification for this request (server_no_result); treating that as this deployment's answer: auto mode classifies locally for the rest of this session and stops sending the classifier context

自动审批 ignored：claude-sonnet-5；请求到达本地 CPA 替身，审批后执行了本地 POST。
```text
2026-10-29T06:56:28.569Z [INFO] [Stall] classifier_request_started reqId=<isolated> tool=Bash model=claude-sonnet-5 stage=xml_s1 promptTokensEst=[REDACTED]
{"path":"/v1/messages","model":"claude-sonnet-5","auth":true}
```
