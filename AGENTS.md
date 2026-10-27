# Pluck

## Pitfalls

- 不要在本机用真实 `~/.claude` 做试验；验证一律设置独立的 `CLAUDE_CONFIG_DIR`。子进程启动 CLI 前去掉继承的 `CLAUDE*` / `ANTHROPIC*` 环境变量，否则会带入当前会话的标记与连接。
- 隔离目录位于用户目录下时，CLI 会向上找到 `~/.claude/CLAUDE.md` 并询问外部引用；脚本需选择拒绝。`scripts/verify-cli.mjs` 已处理信任与外部引用两种启动确认。
- 本机 `127.0.0.1:18317` 被真实的 CPA Manager Plus 占用；CPA 替身使用空闲端口（脚本自动分配）。
- Git Bash 会把 `/model` 之类参数改写成路径；在 Bash 中运行 PTY 脚本需 `MSYS_NO_PATHCONV=1`，或改用 PowerShell。
- 验证不自动操作用户的鼠标、托盘或其他窗口。日常运行类型检查与 Rust 测试，CLI 兼容检查和资源测量按改动需要运行；人工检查见 `docs/verification/checks.md`。
- Windows 的 WebView 创建不能放在同步命令或事件回调中（Tauri 已知死锁）；从工作线程创建。资源测量复用生产入口，全程隐藏、不获取焦点。
- `pnpm tauri build` 运行期间不要执行 `pnpm add` / `pnpm install`，否则 `node_modules/.bin` 被替换导致构建结尾报错。
- PowerShell 脚本含中文时保存为 UTF-8 BOM；字符串中不要用中文弯引号 `“”`，PowerShell 会把它当作字符串定界符。
- 用 `Copy-Item` 把旧版本源文件换回或换出时会保留原修改时间，cargo 可能不重新编译而沿用旧产物；换文件后更新修改时间（或 `cargo clean -p pluck`）再测。
