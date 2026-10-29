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
| `src-tauri/src/desktop.rs` | Tauri 命令、托盘菜单与提示、按需创建配置窗口、关闭后释放 WebView、单实例、每秒检查两个配置文件的变化 |
| `src/App.tsx`、`src/styles.css` | Claude Code 单页、连接/未保存确认弹窗、模型列表与用途分栏、设置；弹窗焦点约束和返回 |
| `src/useWorkspace.ts` | 已保存模型基准与草稿、独立连接草稿、读取请求序号、外部变化协调、写入互斥及原生关闭处理 |
| `src/api.ts` | 生产 Tauri 命令及类型边界 |
| `src-tauri/examples/pluckctl.rs` | 验证用命令行，复用服务层；不随应用发布 |
| `src-tauri/examples/resources.rs` | 复用生产后台与窗口工厂，隔离实例中创建和关闭隐藏窗口，供按需资源测量 |
| `scripts/` | CPA 替身、按需的 CLI 原生菜单兼容检查与 Windows 资源测量（见 README“验证”） |

## 数据与边界

- 写入：仅用户级 `settings.json` 的管理范围字段，以及 Pluck 自己的 `state.json`（默认 `%APPDATA%\com.pluck.desktop`，可用 `PLUCK_DATA_DIR` 覆盖）。
- 只读：`.credentials.json` 仅检测是否存在；项目级设置不读不写。
- 模式不单独保存，每次从实时 `settings.json` 判定；切换顺序为：读取并校验 → 当前模式模型字段写入快照 → 以实时文件为底应用目标模式 → 原子写入。
- CPA 使用中修改连接时，先保存完整原状态，再写本机数据与用户配置；用户配置写入失败则恢复原本机数据，包括已有模型列表和获取时间。模型草稿保存校验带 live/saved 来源的模型字段摘要，拒绝覆盖草稿打开后的相关外部修改；无关设置变化不产生草稿冲突，写入以最新完整文件为底，并保留文件层完整摘要的原子复核。连接保存校验地址与完整 Key 的摘要（不因尾号相同而漏报），返回同锁内的前后模型基准与新列表；界面仅在原基准吻合时协调自有操作，其余保留原 revision 并提示冲突。获取模型期间地址或 Key 改变会拒绝晚到结果。
- Key 明文保存在 `state.json`，CPA 使用中写入 `env.ANTHROPIC_AUTH_TOKEN`；窗口只显示尾号。模型菜单默认保留内置选项，用户可明确选择替换，理由见 ADR 0002。
- 托盘与服务层不依赖窗口。启动时配置窗口按需创建，`--hidden` 不创建 WebView；窗口关闭后销毁，托盘退出才结束应用。原生关闭请求通过 Tauri `onCloseRequested` 处理：干净状态直接销毁；有草稿则先阻止关闭，保存/放弃确认成功后调用 `destroy`，失败保留编辑；写入期间阻止重复关闭。最小化保留当前草稿，重新打开读取已保存配置。
- 窗口从工作线程创建（遵循 Tauri 在 Windows 上的要求），打开请求合并，避免重复创建同名窗口。最后一个窗口关闭不触发应用退出，显式退出不拦截。
- 窗口内模式切换也先处理两类草稿；设置往返、连接取消与列表刷新保留模型编辑。未编辑时外部读取更新基准；已编辑时只更新列表并比较来源/revision，保留草稿和原版本。读取请求以序号拒绝晚到结果；配置通知用独立序号记录，仅有效读取确认已协调的通知。操作完成前补读尚未协调的通知，补读期间有新通知则继续读取；被操作废弃的在途读取不会吞掉通知。写入期间控件禁用，后台读取不会阻塞渲染。
- 每次刷新复用同一份状态构建托盘菜单与提示。窗口操作由返回值立即更新，不再额外广播一次全量刷新；文件监视继续负责同步实时配置，托盘操作主动通知窗口。
- 自动审批模型属于模型管理字段：`env.CLAUDE_CODE_AUTO_MODE_MODEL` 随官方/CPA 各自的最新已保存值切换；CPA 编辑器使用与其他用途相同的列表、显示名和完整 ID。未指定时交由 CLI 选择审批默认，不跟随主模型。旧快照缺少该字段表示未指定，切换前仍会收录当前实时文件中的值；旧版未记录的历史值无法推断恢复。
- 自动审批字段需 Claude Code 2.1.302+；Pluck 保存的是用户级选择，Anthropic 配置、组织模型策略或服务端审批可覆盖它。CLI 实际模型与请求去向须分别用调试日志和服务请求证明，不能由模型 ID 判断是否直连官方。支持条件与验证证据见 [自动审批兼容说明](verification/auto-approval.md)。
- 未改动持久数据格式；现有 `state.json`、模型快照与 Claude 用户级配置继续沿用原有读写路径。验证边界见 [验证约定](verification/checks.md)。
- [首版资源测量](verification/resources.md)：Windows release 隔离入口连续 5 次创建/关闭，关闭后均回到 1 个进程、55.9–56.1 MiB 专用内存；窗口创建为 1.3–3.1 秒。相比[首版记录](verification/first-release.md)中的隐藏常驻，主要变化是 WebView 子进程会回收；这不是长期无泄漏的证明。

新版单页界面、固定旧数据、关闭边界与隐藏资源测量的交付证据见 [0.2.0 验证记录](verification/single-page.md)。
