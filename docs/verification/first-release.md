# 首版验证记录

本文保留首版产物的历史证据；后续已移除操纵桌面的自动验证，当前入口与边界见 [验证约定](checks.md)。

记录日期 2026-10-27。环境：Windows 11 Pro 10.0.26200，12 个逻辑核；Claude Code 2.1.311；Node.js 24.13，Rust 1.92（MSVC）。所有验证使用隔离的 `CLAUDE_CONFIG_DIR` 与 Pluck 数据目录，未读写当前用户真实配置；报告中不含 Key。

## 入口与结果

| 入口 | 覆盖 | 结果 |
| --- | --- | --- |
| `pnpm test:rust` | 读写校验、BOM/CRLF、外部修改、只读、Windows 文件占用、切换往返与字段保留、未知连接拒写、CPA 使用中改地址时任一文件写入失败的一致性（含已有模型列表与获取时间）、旧草稿不覆盖往返中记录的 CLI 保存值、CPA 响应解析与失败 | 28 项通过 |
| `pnpm verify:cli` | CPA 替身 + 服务层 + 真实 CLI：列表获取与失败、`/model` 菜单显示与选择实际 ID、CLI 保存的 Y 在往返与重开后保留、会话临时选择不落盘、项目级与 `--model` 覆盖、凭据不变 | 32/32，[报告](cli-report.md) |
| `pnpm verify:desktop` | `pluck.exe` 实际运行：窗口编辑与切换、托盘状态/菜单/切换/打开/退出、外部修改同步、列表获取失败、只读与损坏文件、关闭后常驻、重开读回 | 34/34，[报告](desktop-report.md) |
| `pnpm tauri build` | 构建 `pluck.exe` 与 NSIS 安装包 `Pluck_0.1.0_x64-setup.exe`（1.9 MiB） | 成功 |

截图：[模型配置](desktop/window-models.png)、[CPA 状态](desktop/window-cpa.png)、[写入失败提示](desktop/window-write-failure.png)、[重开读回](desktop/window-reopened.png)、[托盘菜单](desktop/tray-menu-cpa.png)、[托盘失败结果](desktop/tray-menu-failure.png)、[配置损坏时的托盘](desktop/tray-menu-corrupt.png)。

## 产物留存

收尾时原实现工作树的构建产物已不在当前仓库目录中，2026-10-27 从 `3830342a15089d0a3bd307c3ec6543fd1401142b`（包含独立审查批准的 `7167f9a`）重新执行 `pnpm install --frozen-lockfile` 与 `pnpm tauri build`，含 TypeScript 检查，均成功。应用代码未变，上述 CLI、桌面和 Rust 证据继续适用，本轮未重跑这些验证。

exe 与 NSIS 安装包已作为上传附件保存在 [Forge 交付材料](https://192.168.30.11:3674/board/#/materials/727330ab27ea9d01e14036b19cad6889) revision 1，不依赖临时工作树留存。SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `pluck.exe` | `8615b141aa9b0b4c420bc7a9db785d6dceee9ac38fa7d92dd5734b418ee684df` |
| `Pluck_0.1.0_x64-setup.exe` | `3818dcca9d838914a1119ae005ed5a9ddfd8d719c052aa017bc0dd360f6050e7` |

## 观测

取自本机两次桌面验证运行（审查前后各一次，非基准测试），链接的报告为最近一次：

| 项目 | 数值 |
| --- | --- |
| 正常启动到窗口出现 | 1.2–1.8 s；开远程调试的首次启动 2.7–9 s（含 WebView2 建立用户数据目录） |
| 窗口切换官方→CPA（点击到结果显示） | 60–460 ms |
| 托盘切换（点击菜单到文件写入） | 170–310 ms |
| 获取模型列表（本机替身） | 60–280 ms |
| 托盘常驻（窗口关闭 30 秒后） | 7 个进程，专用内存合计约 405–426 MiB，其中 `pluck.exe` 约 65 MiB，其余为 WebView2 进程；CPU 约 0% |

窗口隐藏后 WebView2 进程仍常驻，占用了常驻内存的大部分；是否在隐藏时释放 WebView 留待实际使用反馈。

## 生效边界

- 状态与托盘显示用户级默认配置；验证中项目级 `model` 与 `--model` 启动参数仍覆盖用户级默认，Pluck 切换不改写项目级设置。
- 运行中的 CLI 会话不保证完整切换：切换结果提示重开 CLI。
- CLI 对非 Claude 模型 ID 提示按 200k 上下文处理，不影响菜单选择与请求中的实际 ID。

## 未覆盖

真实 CPA 服务与官方账号的可用性、macOS/Linux 构建、用户真实配置的迁移不在本次验证范围内。
