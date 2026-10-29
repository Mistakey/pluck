# Pluck

自用、精简的 AI 编程工具配置管理软件。

集中处理 Claude Code 的官方订阅与 CPA 使用方式切换，以及 Skill 的按工具管理，减少手动配置和重复维护。

## 已确认的目标

- 支持 Claude Code 在官方订阅和 CPA 之间切换。官方订阅继续通过 Claude Code 原生官方登录使用，不接入 CPA。
- 集中管理 Skill，按工具选择共享或专属内容，避免工具互相看到对方的专属 Skill。
- 提供托盘入口，以及当前模式和模型信息等基础状态展示。
- 保持功能精简，以个人实际使用需求为依据扩展。

## 使用背景

- 当前使用 CPA Plus 管理其他接入，Claude Code 同时存在官方订阅和 CPA 两种使用需求。
- 现有 Skill 通过 junction 等方式合并目录，出现不同工具互相看到专属 Skill 的问题。
- 当前使用 Token Monitor，通过 Hub 汇总不同电脑的 Token 用量。

## 项目状态

Windows 0.2.0 采用 Claude Code 单页配置界面：通过配置窗口和托盘管理 Claude Code CLI 的用户级原生配置，切换官方与 CPA，并把 CPA 的模型列表接入 CLI 原生 `/model` 菜单。Skill 管理属于下一阶段。

采用 Tauri 2、Rust、React 和 TypeScript；Windows 是首个交付平台，不是项目永久的平台限制。首版规格关联 Forge 任务 `pluck-ehl`，任务状态由 Forge 维护。

项目术语见 [GLOSSARY.md](GLOSSARY.md)，选型与配置管理理由见 [技术栈决策](docs/adr/0001-desktop-stack.md) 和 [原生配置决策](docs/adr/0002-native-config-and-saved-changes.md)，外部实现依据见 [CC Switch 与 Magpie 对照](docs/upstream/cc-switch-and-magpie.md)，首版验证记录见 [首版验证](docs/verification/first-release.md)，组件与边界见 [架构](docs/architecture.md)。

后续候选见 [ROADMAP.md](ROADMAP.md)。候选不代表已承诺实现。

## 使用

Windows 10/11 x64 使用 NSIS 当前用户安装包，无需管理员权限，缺少 WebView2 时由标准安装程序引导安装。安装包、签名和应用内更新流程已经实现；公开下载入口、首次正式发布及真实跨版本安装验证由后续发布任务交付，当前没有可用的正式下载地址。构建及维护方法见[发布说明](docs/releases.md)。

已有免安装版先从托盘退出，再手动安装一次安装版。应用标识和数据目录不变，已有连接、Key、列表、模式快照及 Claude 用户配置继续沿用；不要把旧免安装进程的单实例响应当作安装版已启动。

新版产物、SHA-256 与验证记录见 [单页界面交付](docs/verification/single-page.md)。

1. Claude Code 页内点“配置连接”（或“配置 CPA”），在弹窗填写地址和 Key 并保存；已有 Key 不回显明文，留空沿用。保存连接不自动启用 CPA，取消只放弃本次连接输入。
2. 获取模型列表，搜索名称/ID 或筛选“已选”，勾选 CLI `/model` 菜单项；右侧选择默认和子代理模型，在折叠的“别名映射”中配置 opus / sonnet / haiku，保存配置。列表外 ID 会继续显示；全选不会丢掉已选的列表外 ID，清空是明确清除菜单选择。
3. 在本页明确切换到 CPA；官方模式也能编辑 CPA 预设，切回官方时沿用 Claude Code 自己的登录。切换后重新打开 Claude Code CLI。
4. 配置位置、凭据是否存在、环境变量和原生优先级说明集中在左下角“设置”；往返不丢模型草稿。

模型刷新只更新列表。未编辑时窗口跟随已保存值；编辑期间的相关外部变化会保留草稿并提示，不能用旧草稿覆盖新配置。连接弹窗同样保留编辑并提示变化，需要明确重新载入后再保存。失败信息保留在当前上下文中，可关闭提示或修复后重试。

窗口内切换模式或关闭原生窗口前，有未保存修改时可保存后继续、放弃后继续或继续编辑。保存失败或冲突会停止原动作并保留输入。连接弹窗支持 Escape 取消、Tab 循环和关闭后返回焦点；写入期间不接受重复提交或 Escape 丢弃。

确认关闭后 Pluck 留在托盘并释放 WebView；左键单击托盘重新创建配置窗口并读取已保存值，右键可查看状态、切换模式或退出。最小化保留当前编辑。托盘操作仍独立于窗口；托盘切换或外部配置更新会按上述规则与窗口草稿协调。显式退出结束后台。`pluck.exe --hidden` 只启动托盘，不创建 WebView。

正式安装版启动时及每 6 小时检查更新，托盘会显示新版；设置中可手动检查、查看真实包版本和更新说明。只有点击“更新并重启”才下载，未保存的模型和连接修改需先保存或明确放弃，取消、失败或冲突会停止更新并保留未保存输入。检查或下载失败会显示原因并允许重试。更新使用 Tauri 签名校验，验证通过后交给安装程序更新并重启。

### Pluck 修改什么

Pluck 只修改 Claude Code 用户级配置 `settings.json`（`CLAUDE_CONFIG_DIR` 指定的目录，否则为 `%USERPROFILE%\.claude`）中的以下字段，其余设置保持文件中的实时值：

- 连接：`env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_AUTH_TOKEN`（CPA 模式下写入），以及会覆盖官方登录的 `env.ANTHROPIC_API_KEY`。
- 模型：`model`、`modelPicker`，以及 `env` 中的 `CLAUDE_CODE_SUBAGENT_MODEL`、`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_MODEL`、`ANTHROPIC_CUSTOM_MODEL_OPTION*`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL*`。

官方和 CPA 各自保留模型字段的最新已保存值：切走前读取当前文件（包括在 CLI 里用 `/model` 保存的选择），切回时恢复。只对当前会话生效的选择（`/model` 中按 `s`、`--model` 启动参数）不会写入文件，也不会被当作已保存值。Pluck 不读写官方登录凭据（`.credentials.json`），也不修改项目级设置。

以下情况 Pluck 拒绝写入，原文件保持不变，并在窗口或托盘菜单中显示原因：

- `settings.json` 无法解析，或根节点、`env` 不是对象；
- 文件只读、被其他程序占用，或在读取之后被其他程序修改；
- 连接字段既不是官方也不是已保存的 CPA（例如手工配置的其他网关）。如果它就是你的 CPA，在窗口中保存同一地址即可接管。

获取模型列表失败、响应无效或为空时，保留上一次成功获取的列表和现有配置。

### 状态与生效范围

窗口和托盘显示的是用户级默认配置，不代表所有正在运行的 CLI。运行中的会话可能热更新部分新增的环境变量，但删除的变量要重开 CLI 才清除，因此切换后请重开 CLI。项目级设置和 `--model` 等启动参数仍按 Claude Code 原生规则覆盖用户级默认。

CLI 对不认识的模型 ID 会提示按 200k 上下文处理；需要时可参考官方文档为网关模型设置上下文窗口，Pluck 不改写模型 ID。

### 本机数据

CPA 地址、Key、模型列表和各模式的模型快照保存在 `%APPDATA%\com.pluck.desktop\state.json`（设置 `PLUCK_DATA_DIR` 可改到其他目录）。CPA 模式下 Key 同时写入 `settings.json` 的 `ANTHROPIC_AUTH_TOKEN`，这是 Claude Code 使用 CPA 的方式；窗口只显示 Key 尾号。

## 开发

需要 Node.js 22.12+、pnpm 10、Rust 1.90+（MSVC 工具链）和 [Tauri 的 Windows 依赖](https://v2.tauri.app/start/prerequisites/#windows)。

```powershell
pnpm install
pnpm tauri dev          # 开发运行
pnpm tauri build --no-bundle # 构建免安装 src-tauri/target/release/pluck.exe
pnpm tauri build            # NSIS + 签名更新产物，需要签名配置，见发布说明
```

## 验证

```powershell
pnpm typecheck
pnpm test:rust          # 日常回归：核心配置流程与必要失败保护，全程临时目录
pnpm verify:ui          # 生产 UI 的无头布局/草稿/关闭边界与旧数据检查（需要 Edge）
pnpm verify:updates     # 生产后台自动检查、隐藏重建、状态保留；无下载或安装
pnpm test:release       # 版本与完整发布门槛，使用受控 GitHub CLI 边界
pnpm verify:cli         # 按需：配置映射或 Claude 升级后的原生菜单兼容检查
pnpm measure:resources  # 按需：Windows release 后台与隐藏窗口的资源回收测量
```

- `verify:ui` 构建生产前端和隔离服务桥接入口，在独立的无头 Edge 中验证真实组件；截图与行为报告写入 `.forge/tmp/ui`。故障/竞态用受控 IPC，旧版固定样本用实际 Rust 服务读写临时副本；它不操作桌面，也不代表原生窗口的视觉、流畅度与焦点体验。
- `verify:cli` 需要已安装 Claude Code CLI（2.1.242 及以上支持 `modelPicker`）。它在临时目录和独立 PTY 中验证菜单、保存实际 ID、往返与新会话请求，不操作用户桌面，不读写真实 `~/.claude`；`--report 路径` 输出报告，`--keep` 保留隔离目录。
- `measure:resources` 自动构建 release 测量入口，复用生产后台与窗口工厂，使用独立配置和 WebView 数据目录。窗口全程隐藏、不抢焦点、不移动鼠标；记录空闲及 5 次创建/关闭的进程、内存与 CPU，检查子进程是否回收。`--report 路径` 输出报告。
- 窗口和托盘改动后的短人工检查见 [验证约定](docs/verification/checks.md)。不再保留自动控制用户鼠标、托盘或其他窗口的 GUI 脚本。历史首版报告留作当时产物的证据。
- `pnpm mock-cpa -- --port 28317 --key test-key` 单独启动 CPA 替身；`/__set?models=error|invalid|empty|slow|ok` 切换列表行为。
