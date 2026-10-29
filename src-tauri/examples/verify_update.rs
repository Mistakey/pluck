//! Release verification only: reuse the standard updater verifier without a desktop or installer.
use tauri_plugin_updater::UpdaterExt;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err(
            "usage: verify_update <manifest> <installer> (UPDATER_PUBLIC_KEY required)".into(),
        );
    }
    let manifest = serde_json::from_slice(&std::fs::read(&args[0])?)?;
    let key = std::env::var("UPDATER_PUBLIC_KEY")?;
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": key.trim(), "requireSignedVersion": true,
            "endpoints": ["https://example.invalid/latest.json"],
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)?;
    let updater = app
        .updater_builder()
        .target("windows-x86_64")
        .version_comparator(|_, _| true)
        .build()?;
    let update = updater
        .restore_update(manifest)?
        .ok_or("manifest has no update")?;
    update.verify(&std::fs::read(&args[1])?)?;
    println!("Verified signed Windows x64 installer {}", update.version);
    Ok(())
}
