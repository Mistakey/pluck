//! 窗口命令、托盘与配置文件变化监视。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use crate::error::Result;
use crate::managed::{Mode, ModelConfig};
use crate::service::{resolve_claude_dir, ModelView, OpResult, Service, Status};

const TRAY_ID: &str = "pluck-tray";

struct App {
    service: Arc<Service>,
    /// 托盘上展示的最近一次操作结果。
    last_result: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpEvent {
    ok: bool,
    message: String,
    source: &'static str,
}

fn notify(app: &AppHandle) {
    refresh_tray(app);
    let _ = app.emit("status-changed", ());
}

fn record(app: &AppHandle, ok: bool, message: &str, source: &'static str) {
    let state = app.state::<App>();
    *state.last_result.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(if ok { message.to_string() } else { format!("失败：{message}") });
    let _ = app.emit("op-result", OpEvent { ok, message: message.to_string(), source });
}

fn finish(app: &AppHandle, r: Result<OpResult>) -> Result<OpResult> {
    match &r {
        Ok(o) => record(app, true, &o.message, "window"),
        Err(e) => record(app, false, &e.to_string(), "window"),
    }
    notify(app);
    r
}

#[tauri::command]
async fn get_status(state: State<'_, App>) -> std::result::Result<Status, ()> {
    let s = state.service.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || s.status()).await.expect("状态读取线程"))
}

#[tauri::command]
async fn switch_mode(app: AppHandle, state: State<'_, App>, mode: Mode) -> Result<OpResult> {
    let s = state.service.clone();
    let r = tauri::async_runtime::spawn_blocking(move || s.switch(mode)).await.expect("切换线程");
    finish(&app, r)
}

#[tauri::command]
async fn save_cpa(app: AppHandle, state: State<'_, App>, base_url: String, api_key: Option<String>) -> Result<OpResult> {
    let s = state.service.clone();
    let r = tauri::async_runtime::spawn_blocking(move || s.save_cpa(&base_url, api_key.as_deref()))
        .await
        .expect("保存线程");
    finish(&app, r)
}

#[tauri::command]
async fn get_models(state: State<'_, App>) -> Result<ModelView> {
    let s = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || s.model_view()).await.expect("读取线程")
}

#[tauri::command]
async fn refresh_models(state: State<'_, App>) -> Result<ModelView> {
    let s = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || s.refresh_models()).await.expect("获取线程")
}

#[tauri::command]
async fn save_model_config(
    app: AppHandle,
    state: State<'_, App>,
    config: ModelConfig,
    revision: String,
) -> Result<OpResult> {
    let s = state.service.clone();
    let r = tauri::async_runtime::spawn_blocking(move || s.save_model_config(&config, &revision))
        .await
        .expect("保存线程");
    finish(&app, r)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

fn status_lines(s: &Status) -> (String, String) {
    let head = match s.mode.as_str() {
        "error" => "用户配置无法读取".to_string(),
        _ => format!("当前用户级默认：{}", s.mode_label),
    };
    let model = match s.mode.as_str() {
        "error" => truncate(s.error.as_deref().unwrap_or(""), 60),
        _ => format!("默认模型：{}", s.model.as_deref().unwrap_or("未指定（原生默认）")),
    };
    (head, model)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<App>();
    let s = state.service.status();
    let last = state.last_result.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let (head, model) = status_lines(&s);
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "status", head, false, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "status-model", model, false, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "to-official", "切换到官方", s.mode == "cpa", None::<&str>)?)?;
    let cpa_text = if s.cpa_configured { "切换到 CPA" } else { "切换到 CPA（未配置）" };
    menu.append(&MenuItem::with_id(
        app,
        "to-cpa",
        cpa_text,
        s.mode == "official" && s.cpa_configured,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(l) = last {
        menu.append(&MenuItem::with_id(app, "last", format!("上次操作：{}", truncate(&l, 48)), false, None::<&str>)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", "打开配置窗口", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "退出 Pluck", true, None::<&str>)?)?;
    Ok(menu)
}

fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    let s = app.state::<App>().service.status();
    let tip = match s.mode.as_str() {
        "error" => "Pluck · 用户配置无法读取".to_string(),
        _ => format!("Pluck · {} · {}", s.mode_label, s.model.as_deref().unwrap_or("默认模型")),
    };
    let _ = tray.set_tooltip(Some(tip));
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn tray_switch(app: &AppHandle, mode: Mode) {
    let app = app.clone();
    std::thread::spawn(move || {
        let r = app.state::<App>().service.switch(mode);
        match r {
            Ok(o) => record(&app, true, &o.message, "tray"),
            Err(e) => record(&app, false, &e.to_string(), "tray"),
        }
        notify(&app);
    });
}

fn file_stamp(p: &PathBuf) -> Option<(SystemTime, u64)> {
    std::fs::metadata(p).ok().map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()))
}

/// 监视 settings.json 与本机数据：被 CLI 或其他程序修改后刷新托盘与窗口。
fn watch_files(app: AppHandle, paths: Vec<PathBuf>) {
    std::thread::spawn(move || {
        let mut last: Vec<_> = paths.iter().map(file_stamp).collect();
        loop {
            std::thread::sleep(Duration::from_millis(1000));
            let now: Vec<_> = paths.iter().map(file_stamp).collect();
            if now != last {
                last = now;
                notify(&app);
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .invoke_handler(tauri::generate_handler![
            get_status,
            switch_mode,
            save_cpa,
            get_models,
            refresh_models,
            save_model_config
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let claude_dir = resolve_claude_dir(std::env::var("CLAUDE_CONFIG_DIR").ok(), app.path().home_dir().ok())
                .ok_or("无法确定用户目录")?;
            let data_dir = match std::env::var("PLUCK_DATA_DIR").ok().filter(|s| !s.trim().is_empty()) {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            let service = Arc::new(Service::new(claude_dir, &data_dir));
            let watched = vec![service.settings_path(), service.store_path().to_path_buf()];
            app.manage(App { service, last_result: Mutex::new(None) });

            let menu = build_menu(&handle)?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().ok_or("缺少应用图标")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "to-official" => tray_switch(app, Mode::Official),
                    "to-cpa" => tray_switch(app, Mode::Cpa),
                    "open" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
                        event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;
            refresh_tray(&handle);
            watch_files(handle.clone(), watched);

            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口只隐藏，Pluck 继续在托盘常驻。
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Pluck 启动失败");
}
