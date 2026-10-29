# 安装版与应用内更新实现验证

2026-10-29，任务 `pluck-jtb.1`。构建源码提交 `fa224e7b5b742153dd446a8f51d9925db6d2da86`，比较基线 `d6cca12db0d9b479297dbc269ac0c4c0dc0f99d1`。三个包版本均为 `0.2.0`；这是本地实现验证产物，没有宣布新的正式版本。

环境：Windows x64、Rust 1.92.0 MSVC、Node.js 24.13.0、pnpm 10.28.0、Tauri CLI 2.12.4、Rust Tauri 2.12.5、updater 2.14.1、无头 Edge 156.0.4314.50。新检出后执行 `pnpm install --frozen-lockfile`，没有全局安装或改动真实 Claude/Pluck 数据。后台探针与服务测试均使用隔离目录，不自动操作鼠标、桌面或用户托盘。

## 检查结果

| 检查 | 本次结果与边界 |
| --- | --- |
| `pnpm build` | 类型检查、生产前端构建通过；签名打包前再次运行通过 |
| `pnpm test:rust` | 32 项通过（15 个单元、16 个配置服务往返、1 个更新 HTTP/签名集成测试）。固定旧数据继续保留地址、Key、缓存列表、模式快照及无关配置和凭据 |
| `pnpm verify:ui` | 38 项通过。真实生产 React 组件，无头浏览器、受控 IPC；旧数据部分调用实际 Rust 服务。显示服务版本、说明、进度和错误，检查/下载重试、晚到快照、两类草稿的保存/放弃/取消/失败/冲突均通过；确认前不调用安装入口 |
| `pnpm verify:updates` | 生产 `desktop::build` 自动检查实际本地 HTTP 元数据，1 次检查、0 次下载；检查时无 WebView，2 次隐藏窗口创建/销毁后均保留 `9.0.0` 候选与 `0.2.0` 当前版本，窗口均不可见且无焦点。探针目录清理完成 |
| `pnpm test:release` | 3 项通过：版本一致且仅正式版本、仅显式 main workflow dispatch、不完整上传/附件缺失/附件损坏保持 draft；完整回读后才公开，既有标签不可覆盖 |
| Windows 新检出 | `git -c core.autocrlf=true checkout-index --all --prefix=...` 导出独立临时树，签名样本 SHA-256 不变，临时树中发布测试通过；临时树已清理 |
| 签名网络路径 | 真实 updater 检查不取包；检查 503、下载 503 显示原因并可重试；篡改下载不进入 installing，标准 `install` 入口也拒绝不匹配字节，模拟的原程序文件不变；合法固定签名下载可验证 |
| 重复验证 | 修正 HTTP 测试替身的 Windows 非阻塞继承后，更新集成测试连续 20 次通过，再运行完整 Rust 回归通过 |

后台探针覆盖生产后台及原生隐藏窗口状态，UI 检查覆盖真实组件和草稿协调；二者都不代表真实安装升级，也不替代使用者对视觉和流畅度的判断。

## 真实签名产物

从上述源码提交执行与发布工作流相同的本地入口：`scripts/release.mjs prepare` → `pnpm tauri build --bundles nsis --config .forge/tmp/release/tauri.conf.json --ci` → `scripts/release.mjs metadata` → `cargo run --example verify_update ...`。

实际构建出 Windows x64 NSIS 安装包（2.07 MiB）及 `.sig`，并生成 `latest.json`、`build-info.json`、`SHA256SUMS.txt`。生成的 NSIS 脚本为 `INSTALLMODE currentUser`，应用标识仍为 `com.pluck.desktop`。安装识别还要求 HKCU 安装位置和二进制名称与当前运行路径一致；路径测试拒绝带 NSIS 打包标记的其他目录免安装副本，不试写真实注册表。

| 附件 | SHA-256 |
| --- | --- |
| `Pluck_0.2.0_x64-setup.exe` | `e21b88061d16c6271c5b5c259416518964beb73c077dc70ab733b3e8aed06680` |
| `Pluck_0.2.0_x64-setup.exe.sig` | `6c8378145a401266c03868d96f571ae3a553f47627f0e96d4c77f3507d018988` |
| `latest.json` | `79b36225120321175a0a0d3d6f0c78e1bf6b818e60a62bc12c02dd0767177584` |
| `build-info.json` | `01e86210b4e13e3498ddc0d65002b5d721993e111ab6b0be4641e0b85c77d3b4` |

标准 updater 对实际安装包返回 `Verified signed Windows x64 installer 0.2.0`。复制安装包并改变一个字节后，同一验证器返回 `Minisign(InvalidSignature)`、退出非零，原安装包摘要未变化。没有运行成功安装；服务集成测试已证明签名拒绝发生在替换之前。

本次使用一次性验证密钥，公钥与固定测试样本一致；验证私钥已删除，未提交或上传。构建中的仓库名是不可用于正式发布的 `verification/pluck`，附件仅供审核，不能分发为正式版。正式私钥、公钥和 GitHub 仓库尚待首次发布任务配置。

## 留待发布任务的证据

公开 GitHub 仓库和下载 URL、GitHub Actions 远端实际运行、旧免安装版到安装版、安装版跨版本更新及重启、单实例影响的实际进程/路径证据，后续已由 `pluck-jtb.2` 验证完成，见[公开发布验证](publication.md)。公司电脑首次安装属于 `pluck-jtb.3`。本实现任务当时没有向 GitHub 推送、创建 Release、操作真实配置或在本机安装。重复发布方法见[发布维护](../releases.md)。
