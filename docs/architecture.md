# 架构

Pluck 是 Tauri 2 桌面应用：Rust 负责配置文件与网络，React/TypeScript 负责配置窗口，Tauri 提供窗口与托盘。选型理由见 [ADR 0001](adr/0001-desktop-stack.md)，配置管理规则见 [ADR 0002](adr/0002-native-config-and-saved-changes.md)。

## 组件

| 路径 | 职责 |
| --- | --- |
| `src-tauri/src/settings_file.rs` | 读取并校验 Claude Code `settings.json`（损坏、根或 `env` 非对象即报错）；临时文件 + 原子替换写入，替换前复核内容摘要；保留 BOM、CRLF 与末尾换行 |
| `src-tauri/src/managed.rs` | 管理范围（连接字段、模型字段）、按实时文件判定模式（官方 / CPA / 其他连接）、提取与应用模型字段、界面模型配置与 `modelPicker` 的互相转换 |
| `src-tauri/src/store.rs` | Pluck 本机数据 `state.json`：CPA 地址与 Key、最近一次成功获取的模型列表、各模式的模型字段快照 |
| `src-tauri/src/cpa.rs` | 请求 CPA `/v1/models`，校验响应；失败不改动任何数据 |
| `src-tauri/src/service.rs` | 面向窗口和托盘的操作：状态、切换、保存 CPA、获取列表、保存模型配置；进程内互斥，配置目录解析（`CLAUDE_CONFIG_DIR`，否则 `~/.claude`） |
| `src-tauri/src/desktop.rs` | Tauri 命令、托盘菜单与提示、关闭窗口即隐藏、单实例、每秒检查 `settings.json` 与 `state.json` 变化并刷新窗口和托盘 |
| `src/` | React 配置窗口，通过 `src/api.ts` 调用 Tauri 命令 |
| `src-tauri/examples/pluckctl.rs` | 验证用命令行，复用服务层；不随应用发布 |
| `scripts/` | CPA 替身、真实 CLI 隔离验证、桌面与托盘验证（见 README“验证”） |

## 数据与边界

- 写入：仅用户级 `settings.json` 的管理范围字段，以及 Pluck 自己的 `state.json`（默认 `%APPDATA%\com.pluck.desktop`，可用 `PLUCK_DATA_DIR` 覆盖）。
- 只读：`.credentials.json` 仅检测是否存在；项目级设置不读不写。
- 模式不单独保存，每次从实时 `settings.json` 判定；切换顺序为：读取并校验 → 当前模式模型字段写入快照 → 以实时文件为底应用目标模式 → 原子写入。
- CPA 使用中修改连接时，先保存完整原状态，再写本机数据与用户配置；用户配置写入失败则恢复原本机数据，包括已有模型列表和获取时间。模型草稿保存校验实时文件或 CPA 快照内容摘要，拒绝覆盖草稿打开后的外部修改。
- Key 明文保存在 `state.json`，CPA 使用中写入 `env.ANTHROPIC_AUTH_TOKEN`；窗口只显示尾号。模型菜单默认保留内置选项，用户可明确选择替换，理由见 ADR 0002。
- 关闭窗口仅隐藏窗口，WebView2 与主进程继续常驻，托盘退出才结束应用。实测资源记录见 [首版验证](verification/first-release.md)；隐藏时释放 WebView 尚未实现。
