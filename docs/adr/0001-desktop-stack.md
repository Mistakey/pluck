# 使用 Tauri 2、Rust、React 和 TypeScript

> Source: pluck-ehl (D1)

Windows 是首个交付平台，而不是项目永久的平台边界。采用 Tauri 2、Rust、React 和 TypeScript：React/TypeScript 承载配置界面，Rust 承载文件与网络操作，Tauri 提供桌面和托盘能力。这样保留后续平台扩展空间，也便于参考 CC Switch 的同类实现；代价是需要维护 Rust 与 TypeScript 两部分代码及其接口。

## 考虑过的方案

- C#/.NET 与 WPF：适用于 Windows 桌面应用，但 WPF 把界面绑定在 Windows；把“首版 Windows”解释为长期仅支持 Windows，不符合本项目方向。
- 按“原生界面必然性能最好”选型：没有实际应用测量作为依据，不据此选框架。启动、常驻资源和切换响应通过 Windows 运行产物验证。

参考：[Tauri 托盘能力](https://v2.tauri.app/learn/system-tray/)、[Windows 开发依赖](https://v2.tauri.app/start/prerequisites/#windows)、[CC Switch 固定版本的依赖](https://github.com/farion1231/cc-switch/blob/e55d8a21b3897b595b746e9f2139716b2931641d/src-tauri/Cargo.toml)。
