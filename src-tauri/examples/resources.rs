//! 按需运行的资源测量入口。复用生产窗口工厂，全程隐藏、不获取焦点。
//! 由 scripts/measure-resources.mjs 设置隔离目录并采样进程树。

use std::io::{self, BufRead};
use std::time::{Duration, Instant};

use pluck_lib::desktop;
use tauri::{Manager, RunEvent};

fn stage(name: &str, cycle: usize, elapsed: Duration) {
    println!("{}", serde_json::json!({"stage": name, "cycle": cycle, "elapsedMs": elapsed.as_millis()}));
    // 等采样结束再继续，避免快进到下一阶段。
    io::stdin().lock().lines().next().expect("采样器已退出").expect("读取采样确认");
}

fn main() {
    let mut context = tauri::generate_context!();
    // 独立实例和 WebView 数据目录，绝不唤起用户正在运行的 Pluck。
    context.config_mut().identifier = "com.pluck.resource-probe".into();
    context.config_mut().app.windows[0].data_directory =
        Some(std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").expect("测量器应设置独立 WebView 目录").into());
    desktop::build(context).run(|app, event| {
        desktop::keep_tray_running(&event);
        if matches!(event, RunEvent::Ready) {
            let app = app.clone();
            std::thread::spawn(move || {
                let result = (|| -> tauri::Result<()> {
                    stage("idle", 0, Duration::ZERO);
                    for cycle in 1..=5 {
                        let start = Instant::now();
                        let window = desktop::create_window(&app)?;
                        stage("open", cycle, start.elapsed());
                        let start = Instant::now();
                        window.close()?;
                        drop(window);
                        while app.get_webview_window("main").is_some() {
                            if start.elapsed() > Duration::from_secs(10) {
                                return Err(tauri::Error::WindowNotFound);
                            }
                            std::thread::sleep(Duration::from_millis(25));
                        }
                        stage("closed", cycle, start.elapsed());
                    }
                    Ok(())
                })();
                if let Err(e) = result {
                    eprintln!("资源测量失败：{e}");
                    app.exit(1);
                } else {
                    app.exit(0);
                }
            });
        }
    });
}
