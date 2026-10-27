# Pluck

## Pitfalls

- 不要在本机用真实 `~/.claude` 做试验；验证一律设置独立的 `CLAUDE_CONFIG_DIR`。子进程启动 CLI 前去掉继承的 `CLAUDE*` / `ANTHROPIC*` 环境变量，否则会带入当前会话的标记与连接。
- 隔离目录位于用户目录下时，CLI 会向上找到 `~/.claude/CLAUDE.md` 并询问外部引用；脚本需选择拒绝。`scripts/verify-cli.mjs` 已处理信任与外部引用两种启动确认。
- 本机 `127.0.0.1:18317` 被真实的 CPA Manager Plus 占用；CPA 替身使用空闲端口（脚本自动分配）。
- Git Bash 会把 `/model` 之类参数改写成路径；在 Bash 中运行 PTY 脚本需 `MSYS_NO_PATHCONV=1`，或改用 PowerShell。
- Pluck 托盘菜单是自绘菜单，UI Automation 读不到菜单项；`scripts/lib/tray.ps1` 通过 `MN_GETHMENU` 读取文字与位置并用鼠标点击。不要用键盘注入操作托盘菜单：菜单未获得焦点时按键会落到其他窗口。
- WebView2 窗口隐藏后 `document.visibilityState` 仍为 `visible`；判断窗口可见性用 UI Automation 顶层窗口。
- 桌面验证要求会话未锁屏（锁屏时截屏报“句柄无效”、通知区域无法展开）。
- `pnpm tauri build` 运行期间不要执行 `pnpm add` / `pnpm install`，否则 `node_modules/.bin` 被替换导致构建结尾报错。
- PowerShell 脚本含中文时保存为 UTF-8 BOM；字符串中不要用中文弯引号 `“”`，PowerShell 会把它当作字符串定界符。
