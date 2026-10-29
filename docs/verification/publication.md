# 公开发布与真实安装升级

任务 `pluck-jtb.2`，2026-10-29。本记录只将已完成检查记为通过。

## 上传范围与签名部署

- 公开仓库：[Mistakey/pluck](https://github.com/Mistakey/pluck)，默认分支 main；首次推送为已经独立 AI 审核并交付的 `1b0fab34f69ce0d8e85a7f2c09fd2e10277515c8`，只推送 main 及本任务分支，没有推送其他历史分支或标签。
- 首次上传前使用 Gitleaks 8.30.1 检查可达历史，并用 `git archive main` 导出准确上传树单独扫描。历史与导出树各有两处命中，均为 `docs/verification/fixtures/legacy-cpa` 中的虚构 `isolated-legacy-key-1234`；生成依据在该目录 README。其 `.credentials.json` 同样是明确的虚构固定样本，报告与截图对应临时隔离目录。未发现真实凭据、用户配置或更新私钥。
- 首次上传范围共 31 个可达提交；Gitleaks 对其中 22 个有差异的非合并提交扫描约 595 KB。实际树扫描约 515 KB。未改写历史或将测试样本伪装为真实数据。
- 正式私钥在仓库之外生成，部署 Actions secrets 与公钥变量，保管方式见[发布维护](../releases.md)。公开上传内容不含私钥或密码；该目录保留作后续发布所需材料。
- 最终新增历史扫描的四处命中均是本报告 JSON 中虚构凭据文件的 SHA-256 摘要，已与固定样本实际摘要逐项核对；最终上传树另有前述两处虚构 Key。没有把这些摘要当作凭据，也没有增加目录级忽略规则。

## 执行记录

0.2.0 首次正式构建与发布由[手动工作流](https://github.com/Mistakey/pluck/actions/runs/40859730527)执行，全部步骤成功，2026-10-29 10:54:25 UTC 公开。该运行通过 Rust 32 项、生产 UI 38 项、真实后台更新探针、发布 3 项和实际安装包标准验签；最后才将完整 draft 设为 latest。

| 版本 | 源码提交 | 安装包 SHA-256 |
| --- | --- | --- |
| 0.2.0 | `1b0fab34f69ce0d8e85a7f2c09fd2e10277515c8` | `78c0cf31b234b36251c6f3646014d1b1468e8158ddc032b827fb6331c9d48f19` |
| 0.2.1 | `d1a6846bda281736ad12bd308304fb78cf4f0532` | `0e6f2b5abe9a0d72511d9cc763a8fdae0bd1b92e19a6d349e59393d4bb1c145d` |

[0.2.0 安装包](https://github.com/Mistakey/pluck/releases/download/v0.2.0/Pluck_0.2.0_x64-setup.exe)、[五件套校验清单](https://github.com/Mistakey/pluck/releases/download/v0.2.0/SHA256SUMS.txt)和[构建提交与摘要](https://github.com/Mistakey/pluck/releases/download/v0.2.0/build-info.json)均公开可访问。本次使用无身份请求实际获取固定 latest 元数据和安装包，并将匿名下载字节与五件套摘要逐项核对，通过。维护机 Node 原生 fetch 首次直连 GitHub 超时，随后使用支持本机代理的 curl 完成匿名下载；未修改客户端联网逻辑。

0.2.1 最终签名构建为[运行 40869182120](https://github.com/Mistakey/pluck/actions/runs/40869182120)，同样通过 Rust 32 项、生产 UI 38 项、后台更新探针、发布 3 项和标准验签。完整公开由[运行 40869393215](https://github.com/Mistakey/pluck/actions/runs/40869393215)完成，2026-10-29 12:06:11 UTC 设为 latest。版本标签与 `build-info.json` 均指向上述源码提交；[安装包](https://github.com/Mistakey/pluck/releases/download/v0.2.1/Pluck_0.2.1_x64-setup.exe)、[校验清单](https://github.com/Mistakey/pluck/releases/download/v0.2.1/SHA256SUMS.txt)和固定 latest 元数据经匿名下载复核，与签名构建字节一致。

## 真实失败发布与发现时机

运行 40869393215 调用生产 `publish` 函数，真实上传缺少 `latest.json` 的四件草稿，回读检查因附件不完整拒绝公开。GitHub draft 为 true，固定 latest 仍为 0.2.0，实际已安装客户端点击检查后仍显示“已是最新版本”。删除该未公开草稿后，生产函数上传完整五件套、下载回读并校验，最后才公开 0.2.1。首次检查遇到 latest 入口尚返回旧状态；后续实际客户端通过原有检查入口发现 0.2.1，没有更改生产网络实现或替换更新响应。

原运行保留真实失败草稿证据，后续[运行 40873163224](https://github.com/Mistakey/pluck/actions/runs/40873163224)核对其构建、公开附件与该证据一致，只继续验证已公开产物，没有覆盖或重新发布版本。

## 免安装迁移与真实应用内升级

环境为 GitHub 托管的临时 Windows VM。固定旧样本来自 `fixtures/legacy-cpa`，旧免安装程序从 `d6cca12db0d9b479297dbc269ac0c4c0dc0f99d1` 实际构建，SHA-256 为 `0d0185b4c221757c36b5ec967898a7b3ff77f7dbba4838958b67de4513c22938`。实际安装完成后旧进程仍存活，安装版第二实例返回 0 并把启动请求转给旧进程；退出旧实例后才以安装路径启动。没有把这个第二实例的正常退出当作安装版已运行。

最终实装运行成功，原始进程、窗口、注册表及摘要记录见 [publication-report.json](publication-report.json)。全程使用独立 Claude、Pluck 和 WebView 目录，并写入临时 Windows 用户环境，使 NSIS 重启仍使用同一目录。自动化只在该 VM 的指定 Pluck PID 上读取无障碍控件和调用按钮，未操作本机鼠标、托盘或其他窗口，未模拟 IPC、安装器或下载响应。

| 对象 | 安装前 | 更新并重启后 |
| --- | --- | --- |
| 实际版本与 HKCU DisplayVersion | 0.2.0 | 0.2.1 |
| 应用进程 PID | 2936 | 4924（原进程已退出） |
| 路径 | `C:\Users\runneradmin\AppData\Local\Pluck\pluck.exe` | 同一安装位置 |
| 程序 SHA-256 | `92f58ec1ce9c27ae97cf6e3d2af5f9814e16ac00b1ad1914e68859136e81793f` | `023e07bc75a7686d518140eccbf1376e1a7e65c7ed3e006c4ff7f3eaf7dbe638` |

两份实际程序摘要分别与各自已签名 NSIS 安装包中解出的程序一致。用户动作由真实安装版“更新并重启”按钮发起，经过实际网络下载、标准验签、NSIS 替换和自动重启。新进程 UI 再次显示 CPA、0.2.1 及原隔离目录；最终验证于 12:26:41 UTC 完成。

| 已有文件 | 前后相同的 SHA-256 | 覆盖 |
| --- | --- | --- |
| `state.json` | `4f790c1e7883bbe1ae014efba448d299d24defd9e55577a008e5386b1425c95a` | CPA 地址/Key、模型列表与时间、官方/CPA 快照 |
| `settings.json` | `8f63585aae5d49a90a5dabecf4853570ccfb907f7f5b19548eac246e8f13d491` | Claude 用户设置、连接及模型字段、无关设置 |
| `.credentials.json` | `4b782bb9c940b0ccbf46d83c522e0aa90b526e20a163aebba10725cf36589c17` | 原凭据逐字节保持 |

## 验证中修正的实际边界

- WebView2 155 正常运行，但指定调试端口未进入其启动参数；采用仅限托管 VM 的无障碍接口，不给产品加入调试入口。该接口把版本标签和值拆成多个 Text 节点，核对时合并空白。
- GitHub 工作流 token 为不同工作流提交创建发布返回 403，已固定构建和发布验证到同一提交。新 draft 尚无 Git 标签，清理时只删除 draft，避免 `--cleanup-tag` 的引用不存在错误。
- NSIS 重启使用 Windows 用户环境；只给启动进程设置临时目录变量会使重启落回默认配置。测试用户的持久环境现与启动环境一致，重启后目录和数据均核对通过。
- 构建目录 exe 摘要与安装包交付的 exe 不同；验证现从已签名安装器解包，按实际交付程序核对替换，未降低校验要求。

这些修正均限于发布/验证基础设施，应用业务逻辑和持久数据格式复用已审实现。公司电脑首次安装仍由使用者完成，步骤见[发布维护](../releases.md)。
