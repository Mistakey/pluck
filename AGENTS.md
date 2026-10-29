# Pluck

## Pitfalls

- 不要在本机用真实 `~/.claude` 做试验；验证一律设置独立的 `CLAUDE_CONFIG_DIR`。子进程启动 CLI 前去掉继承的 `CLAUDE*` / `ANTHROPIC*` 环境变量，否则会带入当前会话的标记与连接。
- 隔离目录位于用户目录下时，CLI 会向上找到 `~/.claude/CLAUDE.md` 并询问外部引用；脚本需选择拒绝。`scripts/verify-cli.mjs` 已处理信任与外部引用两种启动确认。
- 本机 `127.0.0.1:18317` 被真实的 CPA Manager Plus 占用；CPA 替身使用空闲端口（脚本自动分配）。
- Git Bash 会把 `/model` 之类参数改写成路径；在 Bash 中运行 PTY 脚本需 `MSYS_NO_PATHCONV=1`，或改用 PowerShell。
- CLI 2.1.312 的主提示符和确认菜单使用 `>`；PTY 检查同时识别 `>` / `❯`。审批替身须按请求中的输出协议返回 block 或 severity XML，否则 CLI 会安全拒绝动作，不能算审批完成。
- 验证不自动操作用户的鼠标、托盘或其他窗口。日常运行类型检查与 Rust 测试，CLI 兼容检查和资源测量按改动需要运行；人工检查见 `docs/verification/checks.md`。
- Windows 的 WebView 创建不能放在同步命令或事件回调中（Tauri 已知死锁）；从工作线程创建。资源测量复用生产入口，全程隐藏、不获取焦点。
- `pnpm tauri build` 运行期间不要执行 `pnpm add` / `pnpm install`，否则 `node_modules/.bin` 被替换导致构建结尾报错。
- PowerShell 脚本含中文时保存为 UTF-8 BOM；字符串中不要用中文弯引号 `“”`，PowerShell 会把它当作字符串定界符。
- 用 `Copy-Item` 把旧版本源文件换回或换出时会保留原修改时间，cargo 可能不重新编译而沿用旧产物；换文件后更新修改时间（或 `cargo clean -p pluck`）再测。
- Windows 下使用 Tauri mock runtime 的集成测试也需要 Common Controls v6 清单；`build.rs` 为 tests 和 examples 链接同一份资源，否则进程启动会报 `STATUS_ENTRYPOINT_NOT_FOUND`。
- GitHub 托管 Windows 的 WebView2 155 实装验证中，环境变量指定的调试端口没有进入浏览器启动参数，不能据此判断应用未启动。真实安装验证使用仅限托管 VM 的 `scripts/lib/installed-ui.ps1`，按应用 PID 读取/调用无障碍控件；React 插值的版本文本会拆为多个节点，核对时合并空白。不要为此给产品加入调试入口或操作本机桌面。
- 真实 NSIS 更新重启使用 Windows 用户环境，不继承测试 shell 的临时目录变量；必须在独立 Windows 用户/VM 中同时配置用户环境，避免重启落回真实配置。替换比对从签名安装器解包取 exe，不能直接用构建目录 exe 的摘要；发布验证与候选构建须固定同一工作流提交，新 draft 没有待清理的 Git 标签。详见 `docs/releases.md`。
