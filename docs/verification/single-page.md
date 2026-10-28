# 单页界面 0.2.0 验证与交付

日期：2026-10-28。实现任务：pluck-h6h.1；体验任务：pluck-h6h.2；收尾：pluck-h6h。代码已通过第 2 轮独立 AI 审核并交付 main（合并提交 `2a24ca2`）。使用者已接受当前 0.2.0，结束本轮体验。

## 产物

[Forge 交付材料（exe、校验值、对应提交与报告）](https://192.168.30.11:3674/board/#/materials/0420268735d50977e7da69342a1dc79b)

- 文件：`pluck-0.2.0-windows-x64.exe`，5,105,664 字节，PE Machine 0x8664；ProductVersion / FileVersion 均为 0.2.0。
- SHA-256：`1a023941221c6ebb9aad9073791175dcd2ed2b101aa434429b9bded9048df109`。
- 实现提交：`c6c12a980dbcfd2480bd481e5dbaebfea92fe0ab`。后续交付文档提交不改动生产代码；最终审核提交在材料中登记。
- Windows 10/11 x64，使用系统 WebView2；下载后直接运行，无需安装 Pluck。`--hidden` 只启动托盘。
- 正常运行读写真实的用户配置；希望在隔离数据下体验时，先在自己的 PowerShell 中设置独立 `CLAUDE_CONFIG_DIR`、`PLUCK_DATA_DIR`，再启动 exe。勿用本机真实配置做验证试验。

## 验收结论

| 验收 | 本次证据与结果 |
| --- | --- |
| A1 / V1 | 生产 dist 在独立无头 Edge 156.0.4314.50 中检查；内容区 1040×688 与 840×544，无全页横向溢出，单个业务导航，设置置底，分栏、折叠与固定保存区可达，多模型在列表区滚动。见下方截图。生产窗口使用系统标题栏，默认 1040×720，最小 840×576。 |
| A2 / V2 | 首次连接/获取/选择/保存/明确启用，以及已有配置的名称和 ID 搜索、已选筛选、默认/子代理/三种别名、仅显示选中项均通过；全选保留原已选的列表外 ID。官方模式可编辑 CPA 预设，保存连接不自动切换。 |
| A3 / V3 | 保存/取消连接、设置往返和刷新保留模型草稿；无编辑跟随外部值，有编辑保留原草稿与版本。重复通知及无关设置变化不误报模型冲突；相关变化、尚未通知的冲突与晚到读取/刷新均不把旧草稿换成新 revision。操作期间的通知、补读期间的新通知及被操作废弃的在途读取，均在操作完成前协调；刷新/连接保存分别覆盖未编辑与已有草稿。连接未编辑跟随、已编辑保留并显示重新载入入口；同尾号不同 Key 也会改变连接版本。 |
| A4 / V4 | 生产组件通过 Tauri 关闭事件边界检查继续编辑/保存/放弃；服务失败或冲突阻止切换和销毁，输入保留。连接失败也阻止关闭；写入期间禁止重复关闭、Escape 或重复提交。Tab 约束、Escape 和焦点返回通过无头检查。原生干净窗口关闭及 WebView 回收由隐藏生产工厂测量验证。 |
| A5 / V5 | 新控件通过当前 Rust pluckctl 读写旧版固定样本的临时副本，保留旧模型 ID、已有 Key、快照、凭据和无关字段，保存用户选择。样本由旧基线 2dd03c2 的 pluckctl 生成，生成顺序见 fixtures/legacy-cpa/README.md。损坏/其他连接/获取失败可见。持久格式未变。 |
| A6 / V6 | 本次源代码构建的新免安装 exe、哈希、提交、截图、UI 行为报告与隐藏资源记录同材料交付。架构和使用说明已更新。H1 已按下述使用者结论结束。 |

## 实际体验与收尾

2026-10-28，使用者打开交付材料 revision 5 的 0.2.0 隔离体验版后明确表示："pluck暂时这个0.2就这样吧"。pluck-h6h.2 据此接受当前版本并结束体验，不追加优化。这不代表逐项手动验证了所有焦点与流程，也不包含生产配置切换或额外发布授权。

A1–A6 复用下列实现与独立审核证据：收尾没有修改生产代码、持久格式或运行条件，因此不重复构建、CLI、UI 或资源检查。审核树为 `34f13cfd31f812cb9c0babe397ef6d554fed154c`，main 已包含该树。实现留下的唯一待办 H1 已由 pluck-h6h.2 结束；审核退回的通知协调问题已由 `c6c12a9` 修复，无本轮未交付项。Skills、多 harness 与同步仍在本轮范围外，候选方向见根目录 ROADMAP.md，扩展原型不是未来设计定案。

长期事实分别保存在 README.md（使用）、docs/architecture.md（组件与边界）、docs/adr/0002-native-config-and-saved-changes.md（原生配置理由）、docs/upstream/cc-switch-and-magpie.md（外部实现对照）、AGENTS.md（隔离与平台陷阱）、docs/verification/checks.md（验证规则）和本记录（产物与验收）。本轮常规可逆的界面组织和状态协调不新增 ADR；没有新增术语或待立项缺口。参考界面的视觉探索仅作过程证据，不把它写成外部实现结论。

生产仓库不含原型实现。收尾核对原型源码包、HTML 和截图已经上传 Forge，确认记录的旧预览进程已结束后，移除本机 `.tmp/pluck-h6h-preview` 临时副本；复现使用原型材料的归档附件。实际 0.2.0 体验目录与进程由使用者体验会话创建，收尾保留，不接管或关闭。

## 检查

- `pnpm install --frozen-lockfile`：新检出按锁文件安装；本任务增加 playwright-core 供独立无头检查，未增加 Forge 准备配置。
- `pnpm build`：类型检查与 Vite 生产构建通过，最终前端资产 `index-CsFVG3w-.js` / `index-C2IJUrZb.css`；release 与资源入口使用同一份生产前端。
- `pnpm verify:ui` 和最终 `node scripts/verify-ui.mjs`：共 27 组通过，详见 [行为报告](single-page/report.json)。受控故障和竞态只替换 IPC 边界，实际生产 React 组件、事件订阅与 Tauri 窗口 API 路径保持不变；旧样本场景使用真实 Rust 服务，而非假保存。
- `pnpm test:rust`：28 项通过（13 项核心单元测试，15 项服务回归），包含同尾号 Key 冲突、连接保存前后模型基准、无关设置变化保留、旧版固定样本、Key 变化后拒绝晚到模型列表及既有安全报错。
- `pnpm tauri build --no-bundle`：Windows x64 release 成功；本次只交付免安装 exe，不要求 NSIS 安装器。
- `pnpm measure:resources --report .forge/tmp/resources-single-page.md`：复用生产后台与 create_window，独立实例、配置和 WebView 目录，全程隐藏且不获取焦点。5 轮关闭后均回到 1 个后台进程，专用内存 55.8–56.0 MiB，2 秒空闲 CPU 增量均为 0；创建请求 559–786 ms，关闭请求约 25 ms。完整数据见 [隐藏资源记录](single-page/resources.md)。
- `git merge --no-ff main`：实现分支已含当前 main，未发生冲突；落地前仍按协议确认目标最新 tip。
- `git diff --check`：通过。原生模型映射未改，因此不重复运行 CLI 兼容检查。

## 截图

以下是生产前端的无头截图，使用隔离测试数据；不是用户桌面截图，也不代替原生使用体验。

标准内容区：

![标准单页](single-page/standard.png)

紧凑内容区：

![紧凑单页](single-page/compact.png)

旧版固定隔离样本的连接弹窗：

![连接弹窗](single-page/connection.png)

设置：

![设置](single-page/settings.png)

## 审核退回的修复验证

第 1 轮审核指出操作期间的 `status-changed` 被丢弃，导致未编辑界面在刷新后停留于旧值。扫描覆盖所有 operation 入口与同步读取；修复使用通知序号，只有有效读取才能确认通知，操作结束前补读未处理通知；写入废弃的旧读取不消费通知。新增 6 组检查在生产组件上覆盖刷新/保存连接的干净与草稿状态、补读中的再次通知及操作开始前的在途读取。新增首例在旧代码上稳定失败，修复后 27 组通过。审核者原始 `.forge/tmp/review-refresh.mjs` 也通过：actualSaved=model-b、displayed=model-b、reads=2。当前材料的 exe 与校验值已按修复提交重新构建，替换上一轮产物。

## 验证边界

本次未操作用户鼠标、托盘或其他窗口，未读写真实 Claude/Pluck 数据，未启动真实 Claude CLI。无头检查不证明原生窗口的感官效果；隐藏测量只证明本次五轮回收及短期稳定范围，不能证明长期零泄漏。正常依赖与构建产物位于任务工作区；测量和无头浏览器的独立外部临时目录由脚本清理。
