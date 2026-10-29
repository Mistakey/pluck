//! 验证生产后台的自动检查与隐藏窗口重建，全程不展示窗口或获取焦点。
use pluck_lib::desktop;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent};

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.pluck.updates-probe".into();
    context.config_mut().app.windows[0].data_directory = Some(
        std::env::var_os("WEBVIEW2_USER_DATA_FOLDER")
            .expect("isolated WebView directory")
            .into(),
    );
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": include_str!("../tests/fixtures/updater/public-key.txt").trim(),
            "endpoints": [std::env::var("PLUCK_PROBE_ENDPOINT").expect("local endpoint")],
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true,
        }),
    );
    desktop::build(context).run(|app, event| {
        desktop::keep_tray_running(&event);
        if matches!(event, RunEvent::Ready) {
            let app = app.clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                    let deadline = Instant::now() + Duration::from_secs(15);
                    loop {
                        let status = desktop::update_status(&app);
                        if status.phase == "available" { break; }
                        if status.phase == "error" || Instant::now() > deadline { return Err(format!("automatic check failed: {status:?}").into()); }
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    assert!(app.webview_windows().is_empty(), "automatic check created a window");
                    for _ in 0..2 {
                        let window = desktop::create_window(&app)?;
                        assert!(!window.is_visible()?);
                        assert!(!window.is_focused()?);
                        assert_eq!(desktop::update_status(&app).version.as_deref(), Some("9.0.0"));
                        window.destroy()?;
                        let deadline = Instant::now() + Duration::from_secs(10);
                        while app.get_webview_window("main").is_some() {
                            if Instant::now() > deadline { return Err("window not destroyed".into()); }
                            std::thread::sleep(Duration::from_millis(25));
                        }
                    }
                    println!("{}", serde_json::json!({"automaticCheck": true, "noWindowOnCheck": true, "hiddenRecreations": 2, "status": desktop::update_status(&app)}));
                    Ok(())
                })();
                if let Err(e) = result { eprintln!("{e}"); app.exit(1); } else { app.exit(0); }
            });
        }
    });
}
