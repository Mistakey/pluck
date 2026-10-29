fn main() {
    tauri_build::build();
    // tauri-build 默认只为主程序链接资源；原生 examples 和 mock runtime 测试也需要 Common Controls v6 清单。
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resource.display());
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
