# Windows 发布维护

交付范围为 Windows 10/11 x64、NSIS 当前用户安装和一个 GitHub Releases 正式渠道。应用标识为 `com.pluck.desktop`，默认 Pluck 数据仍在 `%APPDATA%\com.pluck.desktop`；本轮没有业务数据格式变化或迁移。应用内更新使用标准 `tauri-plugin-updater`，更新签名验证产物来源，Windows 代码签名解决系统发布者信任，两者不同。本轮未采购 Windows 代码签名。

正式公开仓库为 [Mistakey/pluck](https://github.com/Mistakey/pluck)，默认分支为 main。正式渠道固定入口为 `https://github.com/Mistakey/pluck/releases/latest/download/latest.json`，安装包入口为 [Releases](https://github.com/Mistakey/pluck/releases/latest)。签名及构建配置已部署到该仓库；公开版本和真实安装升级结论以[发布验证记录](verification/publication.md)为准。

## 签名材料保管

维护电脑的 `%USERPROFILE%\.pluck-release-signing\updater.key` 是正式更新私钥，`updater.key.pub` 是公钥；同目录的 `password.dpapi` 保存用 Windows 当前用户 DPAPI 加密的密码。目录 ACL 仅允许当前用户和 SYSTEM。目录位于源码和 worktree 之外，不随仓库上传；不要将该目录、解密密码或私钥作为日志、材料附件或 Release 附件。

GitHub Actions 使用仓库 secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，公钥使用 repository variable `UPDATER_PUBLIC_KEY`。GitHub secrets 不能读回原文；迁移维护电脑前应将私钥及密码另作安全备份，DPAPI 文件只能由原 Windows 用户解密，单独拷贝它不能在其他电脑恢复。公钥和固定更新地址必须保持稳定。

正式公钥的公开副本见 [`updater-public-key.txt`](updater-public-key.txt)，已与仓库变量逐字核对。它可用于独立验证签名，不能用于生成签名，不包含私钥。

## 首次部署

1. 在首次公开前核对整个上传范围及 Git 历史，清除真实凭据、个人数据和私钥；再创建公开 GitHub 仓库并推送审核通过的 main。
2. 在仓库外、安全的位置运行 `pnpm exec tauri signer generate --write-keys <私钥路径>`，设置密码。备份私钥和密码；私钥不能提交或作为 Release 附件上传。`.pub` 文件的文本是公钥，允许公开。
3. 设置 GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY`（私钥文件的完整文本）、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，以及 repository variable `UPDATER_PUBLIC_KEY`（`.pub` 文件的完整文本）。只在签名构建步骤注入私钥。
4. 启用 Actions，允许 workflow 使用 `contents: write`。正式更新 URL 由仓库名生成：`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`。不需要内网服务。

已安装客户端内嵌公钥和更新地址，后续必须保持这两个入口可用。丢失私钥不能仅换一个 secret 后继续给旧客户端更新；需另行制定密钥切换或重新手动安装的方案。

## 明确发布一个版本

1. 在同一个变更中修改 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 的版本，并更新 Cargo.lock；使用无 `v` 前缀的稳定 `x.y.z`。代码通过审核进入 main。
2. 使用者明确要求发布后，在 GitHub Actions 手动执行 **Release Windows x64**，选择 main，输入该版本和给使用者看的更新说明。说明按纯文本展示。普通 push、合并、标签推送均不会触发此工作流。
3. 工作流检查版本、渠道和说明；安装锁定依赖，运行 Rust、生产 UI、生产后台和发布门槛回归；构建 NSIS 安装包及 `.sig`。Tauri 配置通过 `.forge/tmp/release/tauri.conf.json` 覆盖层注入正式公钥及地址，基础源码不含未创建仓库的占位 URL。
4. `scripts/release.mjs metadata` 生成固定五件套：`Pluck_<version>_x64-setup.exe`、同名 `.sig`、`latest.json`、`build-info.json`、`SHA256SUMS.txt`。元数据只含 Windows x64；构建信息记录版本、提交和附件摘要。标准 Rust updater 验证签名公钥及签名中的版本后，才能进入发布步骤。
5. 发布步骤先创建 draft，上传全部附件，下载回读并核对附件集合和摘要，最后一次操作才公开并设为 latest。检查、签名、上传或回读失败均不能把这个版本宣布给客户端。已存在的版本标签拒绝覆盖，避免更改客户端已经见过的版本。

失败留下的 draft 不会被正式更新入口发现。修正失败原因后，检查该版本没有公开、没有被客户端使用，再删除这次失败的 draft 和对应的未公开标签，重新触发。不要覆盖已公开附件或移动已有正式标签；正式版问题发布更高版本修复。

## 本地构建与验证

依赖装好后，PowerShell 设置以下环境变量：

```powershell
$env:RELEASE_VERSION = '0.3.0' # 须与当前三个版本号相同
$env:RELEASE_NOTES_FILE = '.forge/tmp/release-notes.md' # 自行写入非空 UTF-8 说明
$env:GITHUB_REPOSITORY = '<owner>/<repo>'
$env:UPDATER_PUBLIC_KEY = (Get-Content -Raw '<公钥路径>').Trim()
$env:TAURI_SIGNING_PRIVATE_KEY = '<仓库外的私钥绝对路径>'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<私钥密码>'
node scripts/release.mjs prepare
pnpm tauri build --bundles nsis --config .forge/tmp/release/tauri.conf.json --ci
node scripts/release.mjs metadata
cargo run --example verify_update --manifest-path src-tauri/Cargo.toml -- .forge/tmp/release/artifacts/latest.json ".forge/tmp/release/artifacts/Pluck_$($env:RELEASE_VERSION)_x64-setup.exe"
```

`prepare` 前建立 `.forge/tmp` 并写好说明。重复生成元数据前仅清空本次 `.forge/tmp/release/artifacts`；脚本拒绝混入上次产物。`verify_update` 只使用标准组件验证，不下载、不安装、不操作真实配置或桌面。正式发布使用手动工作流；本地检查不运行 `publish`。

无公钥或渠道的开发构建会在设置里明确报“尚未配置正式发布渠道”。`--no-bundle` 可构建免安装程序。Tauri 打包也会给构建目录的 exe 写入 NSIS 标记，因此服务除标记外还核对 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Pluck` 的 `InstallLocation` / `MainBinaryName` 与当前程序路径；从其他目录直接运行的 exe 仍需先手动安装正式安装版。

## 安装与升级证据

在独立 Windows 用户或 VM 中完成，不能在本机真实配置上试验。先从旧版托盘显式退出，再安装；检查运行进程的路径和包版本，避免旧免安装实例接收单实例启动请求造成误判。标准 NSIS 安装程序会处理已运行进程，不能把被安装程序关闭或仍在运行的旧版算作新版启动成功。

以固定旧数据为基准，检查 CPA 地址和 Key、缓存列表、两种模式快照、Claude 用户配置及凭据保持；再从较低安装版本经应用内更新到较高版本，检查实际安装位置、进程、版本、重启与文件证据。公司电脑的首次下载和安装由使用者完成。日常自动验证与人工界限见[验证约定](verification/checks.md)。

### 独立 Windows runner 验证

手动工作流在 main 上按上述流程发布。在任务分支上运行时，同样执行回归、签名构建与标准验签，但将五件套和预期安装后二进制摘要保存为 Actions artifacts，供真实安装验证使用。

保持任务分支停留在候选构建的同一提交，再次手动执行 **Release Windows x64**，勾选 `verify_installation`，填写候选版本和成功候选构建的 `build_run`。GitHub 工作流 token 不能为另一个工作流提交创建 Release；构建后修改验证流程需在新提交重新构建候选，不给 CI 配置个人令牌来绕过限制。该模式仅允许 GitHub 托管的临时 Windows VM，拒绝本机和 self-hosted runner；它不会使用签名私钥。`scripts/verify-installation.mjs` 校验候选构建、提交和生产树，下载已公开 0.2.0 及签名候选包，在独立 Claude/Pluck 目录复制旧固定样本，用旧源码实际构建的免安装版验证进程影响，再安装 0.2.0。

验证使用生产发布函数向真实 GitHub 上传缺一件的草稿，确认回读失败、latest 和实际已安装客户端仍停留在 0.2.0；清理这次未公开草稿后，以完整五件套公开候选版。随后通过真实安装版窗口的“更新并重启”完成下载、验签、NSIS 替换及重启。记录安装路径、注册表版本、更新前后进程和程序摘要，并要求三个已有数据文件逐字节保持。`scripts/lib/installed-ui.ps1` 仅在临时托管 VM 中使用 Windows 无障碍接口读取指定 Pluck 进程的窗口并调用按钮；不使用鼠标、托盘或其他窗口，不更换生产 IPC 或安装器，也不在产品中加入调试入口。

排查安装版启动时可勾选 `diagnose_only`：仅安装 0.2.0、检查配置与版本，跳过旧版编译和候选发布。完整运行会在安装前保存 `legacy-portable-d6cca12` artifact；若后续验证失败，可将其运行 ID 填入 `portable_run`，脚本核对该运行的旧版构建步骤确实成功后复用同一二进制，避免改变复现对象。已公开候选的运行不能用这两个参数绕过禁止覆盖版本的门槛。

验证会实际公开候选版本，只在明确发布该版本时运行。若中途失败，先读 `installation-evidence-<version>` 的报告和当前 Release 状态；已公开版本不得删除、覆盖或重新运行发布。未公开草稿按前述失败恢复步骤处理。VM 在作业完成后销毁，报告仅上传摘要和进程证据。
