//! 窗口命令、托盘与配置文件变化监视。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

use crate::error::Result;
use crate::managed::{Mode, ModelConfig};
use crate::service::{resolve_claude_dir, ConnectionResult, ModelView, OpResult, Service, Status};
use crate::updates::{self, UpdateService, UpdateStatus};

const TRAY_ID: &str = "pluck-tray";

struct App {
    service: Arc<Service>,
    /// 托盘上展示的最近一次操作结果。
    last_result: Mutex<Option<String>>,
    opening: AtomicBool,
    updates: Arc<UpdateService>,
    update_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpEvent {
    ok: bool,
    message: String,
    source: &'static str,
}

fn notify(app: &AppHandle, status: &Status) {
    refresh_tray(app, status);
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
    match &r {
        Ok(o) => refresh_tray(app, &o.status),
        Err(_) => refresh_tray(app, &app.state::<App>().service.status()),
    }
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
async fn save_cpa(
    app: AppHandle,
    state: State<'_, App>,
    base_url: String,
    api_key: Option<String>,
    revision: String,
) -> Result<ConnectionResult> {
    let s = state.service.clone();
    let r = tauri::async_runtime::spawn_blocking(move || s.save_cpa(&base_url, api_key.as_deref(), &revision))
        .await
        .expect("保存线程");
    match r {
        Ok(value) => {
            finish(&app, Ok(value.result.clone()))?;
            Ok(value)
        }
        Err(e) => {
            finish(&app, Err(e))?;
            unreachable!()
        }
    }
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
    let r =
        tauri::async_runtime::spawn_blocking(move || s.save_model_config(&config, &revision)).await.expect("保存线程");
    finish(&app, r)
}

#[tauri::command]
fn get_update_status(state: State<'_, App>) -> UpdateStatus {
    state.updates.status()
}

/// 供隔离的原生检查读取与窗口相同的常驻状态。
pub fn update_status(app: &AppHandle) -> UpdateStatus {
    app.state::<App>().updates.status()
}

fn notify_update(app: &AppHandle, status: &UpdateStatus) {
    let _ = app.emit("update-changed", status);
    if status.phase == "downloading" && status.downloaded > 0 { return; }
    // 单独更新既有菜单项，不在每个下载分块上重建整个托盘。
    let item = app.state::<App>().update_item.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(item) = item {
        let _ = item.set_text(updates::tray_text(status));
    }
}

async fn check_updates_impl(app: &AppHandle) -> UpdateStatus {
    let service = app.state::<App>().updates.clone();
    let configured = app.config().plugins.0.get("updater").is_some_and(|c| {
        c["pubkey"].as_str().is_some_and(|s| !s.trim().is_empty())
            && c["endpoints"].as_array().is_some_and(|a| !a.is_empty())
    });
    let updater = if configured {
        app.updater_builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())
    } else {
        Err("此构建尚未配置正式发布渠道，请安装正式发布的版本。".into())
    };
    service.check(updater, |s| notify_update(app, s)).await
}

#[tauri::command]
async fn check_updates(app: AppHandle) -> UpdateStatus {
    check_updates_impl(&app).await
}

#[tauri::command]
async fn install_update(app: AppHandle, version: String) -> std::result::Result<UpdateStatus, String> {
    let service = app.state::<App>().updates.clone();
    service.install(&version, |s| notify_update(&app, s)).await
}

fn start_update_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            check_updates_impl(&app).await;
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
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
        _ => format!("默认模型：{}", s.model_display_name.as_deref().or(s.model.as_deref()).unwrap_or("未指定（原生默认）")),
    };
    (head, model)
}

fn build_menu(app: &AppHandle, s: &Status) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<App>();
    let last = state.last_result.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let (head, model) = status_lines(s);
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "status", head, false, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "status-model", model, false, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "to-official", "切换到官方", s.mode == "cpa", None::<&str>)?)?;
    let cpa_text = if s.cpa_configured { "切换到 CPA" } else { "切换到 CPA（未配置）" };
    menu.append(&MenuItem::with_id(app, "to-cpa", cpa_text, s.mode == "official" && s.cpa_configured, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(l) = last {
        menu.append(&MenuItem::with_id(app, "last", format!("上次操作：{}", truncate(&l, 48)), false, None::<&str>)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", "打开配置窗口", true, None::<&str>)?)?;
    let update_item = MenuItem::with_id(app, "updates", updates::tray_text(&state.updates.status()), true, None::<&str>)?;
    menu.append(&update_item)?;
    *state.update_item.lock().unwrap_or_else(|e| e.into_inner()) = Some(update_item);
    menu.append(&MenuItem::with_id(app, "quit", "退出 Pluck", true, None::<&str>)?)?;
    Ok(menu)
}

fn refresh_tray(app: &AppHandle, s: &Status) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(menu) = build_menu(app, s) {
        let _ = tray.set_menu(Some(menu));
    }
    let _ = tray.set_tooltip(Some(tooltip(s)));
}

fn tooltip(s: &Status) -> String {
    match s.mode.as_str() {
        "error" => "Pluck · 用户配置无法读取".to_string(),
        _ => format!("Pluck · {} · {}", s.mode_label, s.model_display_name.as_deref().or(s.model.as_deref()).unwrap_or("默认模型")),
    }
}

/// 创建时先隐藏，由调用方决定是否展示和获取焦点。
/// 供正常窗口和独立的资源测量入口复用；Windows 必须从工作线程调用。
pub fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?.build()
}

fn show_window(app: &AppHandle) {
    if app.state::<App>().opening.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = (|| -> tauri::Result<()> {
            let w = match app.get_webview_window("main") {
                Some(w) => w,
                None => create_window(&app)?,
            };
            w.unminimize()?;
            w.show()?;
            w.set_focus()
        })();
        app.state::<App>().opening.store(false, Ordering::Release);
        if let Err(e) = result {
            record(&app, false, &format!("打开窗口失败：{e}"), "tray");
            refresh_tray(&app, &app.state::<App>().service.status());
        }
    });
}

fn tray_switch(app: &AppHandle, mode: Mode) {
    let app = app.clone();
    std::thread::spawn(move || {
        let r = app.state::<App>().service.switch(mode);
        match &r {
            Ok(o) => record(&app, true, &o.message, "tray"),
            Err(e) => record(&app, false, &e.to_string(), "tray"),
        }
        match &r {
            Ok(o) => notify(&app, &o.status),
            Err(_) => refresh_tray(&app, &app.state::<App>().service.status()),
        }
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
                notify(&app, &app.state::<App>().service.status());
            }
        }
    });
}

/// 与资源测量共用的生产应用入口，不依赖配置窗口存活。
pub fn build(context: tauri::Context<tauri::Wry>) -> tauri::App {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == "--hidden") {
                show_window(app);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_status,
            switch_mode,
            save_cpa,
            get_models,
            refresh_models,
            save_model_config,
            get_update_status,
            check_updates,
            install_update
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
            let status = service.status();
            let installed = updates::is_current_user_installation();
            let updates = Arc::new(UpdateService::new(app.package_info().version.to_string(), installed));
            app.manage(App { service, last_result: Mutex::new(None), opening: AtomicBool::new(false), updates, update_item: Mutex::new(None) });

            let menu = build_menu(&handle, &status)?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().ok_or("缺少应用图标")?)
                .menu(&menu)
                .tooltip(tooltip(&status))
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "to-official" => tray_switch(app, Mode::Official),
                    "to-cpa" => tray_switch(app, Mode::Cpa),
                    "open" => show_window(app),
                    "updates" => {
                        show_window(app);
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { check_updates_impl(&app).await; });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left, button_state: MouseButtonState::Up, ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;
            watch_files(handle, watched);
            start_update_checks(app.handle().clone());
            Ok(())
        })
        .build(context)
        .expect("Pluck 启动失败")
}

/// 关闭最后一个配置窗口后保留托盘；显式退出仍正常退出。
pub fn keep_tray_running(event: &RunEvent) {
    if let RunEvent::ExitRequested { code: None, api, .. } = event {
        api.prevent_exit();
    }
}

pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    build(tauri::generate_context!()).run(move |app, event| {
        keep_tray_running(&event);
        if matches!(event, RunEvent::Ready) && !hidden {
            show_window(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tray_uses_cpa_names_without_changing_model_ids_or_native_aliases() {
        let root = tempfile::tempdir().unwrap();
        let claude = root.path().join("claude");
        let data = root.path().join("data");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(
            data.join("state.json"),
            json!({
                "version": 1,
                "cpa": {"baseUrl": "http://127.0.0.1:8317", "apiKey": "isolated"},
                "models": [
                    {"id": "claude-fable-test", "displayName": "GPT 5.6 Sol"},
                    {"id": "no-name", "displayName": null},
                    {"id": "empty-name", "displayName": "  "},
                    {"id": "opus", "displayName": "CPA name"}
                ]
            })
            .to_string(),
        )
        .unwrap();
        let service = Service::new(claude.clone(), &data);
        for (mode, id, expected) in [
            ("cpa", Some("claude-fable-test"), "GPT 5.6 Sol"),
            ("cpa", Some("no-name"), "no-name"),
            ("cpa", Some("empty-name"), "empty-name"),
            ("cpa", Some("removed-model"), "removed-model"),
            ("official", Some("opus"), "opus"),
            ("other", Some("claude-fable-test"), "claude-fable-test"),
            ("cpa", None, "未指定（原生默认）"),
        ] {
            let mut settings = json!({"model": id});
            if mode != "official" {
                settings["env"] = json!({"ANTHROPIC_BASE_URL": if mode == "cpa" {
                    "http://127.0.0.1:8317"
                } else { "http://127.0.0.1:8318" }});
            }
            std::fs::write(claude.join("settings.json"), settings.to_string()).unwrap();
            let status = service.status();
            assert_eq!(status.mode, mode);
            assert_eq!(status.model.as_deref(), id);
            assert_eq!(status_lines(&status).1, format!("默认模型：{expected}"));
            assert_eq!(
                tooltip(&status),
                format!(
                    "Pluck · {} · {}",
                    status.mode_label,
                    if id.is_none() {
                        "默认模型"
                    } else {
                        expected
                    }
                )
            );
        }
    }
}
