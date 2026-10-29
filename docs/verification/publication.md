# 公开发布与真实安装升级

任务 `pluck-jtb.2`，2026-10-29。本记录只将已完成检查记为通过。

## 上传范围与签名部署

- 公开仓库：[Mistakey/pluck](https://github.com/Mistakey/pluck)，默认分支 main；首次推送为已经独立 AI 审核并交付的 `1b0fab34f69ce0d8e85a7f2c09fd2e10277515c8`，只推送 main 及本任务分支，没有推送其他历史分支或标签。
- 首次上传前使用 Gitleaks 8.30.1 检查可达历史，并用 `git archive main` 导出准确上传树单独扫描。历史与导出树各有两处命中，均为 `docs/verification/fixtures/legacy-cpa` 中的虚构 `isolated-legacy-key-1234`；生成依据在该目录 README。其 `.credentials.json` 同样是明确的虚构固定样本，报告与截图对应临时隔离目录。未发现真实凭据、用户配置或更新私钥。
- Git 历史共 31 个可达提交；Gitleaks 对其中 22 个有差异的非合并提交扫描约 595 KB。实际树扫描约 515 KB。未改写历史或将测试样本伪装为真实数据。
- 正式私钥在仓库之外生成，部署 Actions secrets 与公钥变量，保管方式见[发布维护](../releases.md)。公开上传内容不含私钥或密码；该目录保留作后续发布所需材料。

## 执行记录

0.2.0 首次正式构建与发布由[手动工作流](https://github.com/Mistakey/pluck/actions/runs/40859730527)执行；0.2.1 签名候选由[候选构建](https://github.com/Mistakey/pluck/actions/runs/40860428762)执行。实际结果及安装证据在验证完成后补齐，当前不将构建中或排队中的运行视为发布/升级成功。
