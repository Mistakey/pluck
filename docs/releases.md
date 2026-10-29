# Windows 发布维护

交付范围为 Windows 10/11 x64、NSIS 当前用户安装和一个 GitHub Releases 正式渠道。应用标识为 `com.pluck.desktop`，默认 Pluck 数据仍在 `%APPDATA%\com.pluck.desktop`；本轮没有业务数据格式变化或迁移。应用内更新使用标准 `tauri-plugin-updater`，更新签名验证产物来源，Windows 代码签名解决系统发布者信任，两者不同。本轮未采购 Windows 代码签名。

当前仅实现和验证构建及发布流程。公开仓库、正式签名配置、首个公开下载 URL，以及旧免安装版转安装版、两个安装版本之间的实际升级证据，由 `pluck-jtb.2` 完成。本文不将模拟 IPC、签名验证或构建成功视为实际安装升级。

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
