//! 标准 updater 的真实 HTTP 与签名路径；不调用成功安装、不操作桌面或注册表。
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

use pluck_lib::updates::{tray_text, UpdateService};
use serde_json::json;
use tauri_plugin_updater::UpdaterExt;

const PAYLOAD: &[u8] = include_bytes!("fixtures/updater/payload.txt");
const PUBLIC_KEY: &str = include_str!("fixtures/updater/public-key.txt");
const SIGNATURE: &str = include_str!("fixtures/updater/payload.txt.sig");

struct Server {
    address: String,
    mode: Arc<AtomicUsize>,
    downloads: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let mode = Arc::new(AtomicUsize::new(0));
        let downloads = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (worker_mode, worker_downloads, worker_stop, worker_address) = (
            mode.clone(),
            downloads.clone(),
            stop.clone(),
            address.clone(),
        );
        let worker = std::thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                let (mut stream, _) = match listener.accept() {
                    Ok(s) => s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut reader = BufReader::new(&mut stream);
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                let mut header = String::new();
                loop {
                    header.clear();
                    if reader.read_line(&mut header).unwrap() == 0 || header == "\r\n" {
                        break;
                    }
                }
                drop(reader);
                let mode = worker_mode.load(Ordering::Relaxed);
                let (status, body) = if request.starts_with("GET /package ") {
                    worker_downloads.fetch_add(1, Ordering::Relaxed);
                    match mode {
                        2 => (503, b"download unavailable".to_vec()),
                        3 => (200, b"tampered package".to_vec()),
                        _ => (200, PAYLOAD.to_vec()),
                    }
                } else if mode == 1 {
                    (503, b"check unavailable".to_vec())
                } else {
                    (
                        200,
                        json!({
                            "version": "9.0.0",
                            "notes": "更新验证说明",
                            "platforms": {"windows-x86_64": {
                                "url": format!("{worker_address}/package"),
                                "signature": SIGNATURE.trim(),
                            }},
                        })
                        .to_string()
                        .into_bytes(),
                    )
                };
                let header = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        Self {
            address,
            mode,
            downloads,
            stop,
            worker: Some(worker),
        }
    }

    fn updater(&self, executable: &std::path::Path) -> tauri_plugin_updater::Updater {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey": PUBLIC_KEY.trim(),
                "endpoints": [format!("{}/latest.json", self.address)],
                "requireSignedVersion": true,
                "dangerousInsecureTransportProtocol": true,
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        app.updater_builder()
            .target("windows-x86_64")
            .no_proxy()
            .executable_path(executable)
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let result = self.worker.take().unwrap().join();
        if !std::thread::panicking() {
            result.unwrap();
        }
    }
}

#[test]
fn resident_service_checks_without_downloading_and_retries_network_and_signature_failures() {
    tauri::async_runtime::block_on(async {
        let server = Server::new();
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("pluck.exe");
        std::fs::write(&executable, b"existing app").unwrap();
        let service = Arc::new(UpdateService::new("0.2.0".into(), true));
        server.mode.store(1, Ordering::Relaxed);
        let failed = service.check(Ok(server.updater(&executable)), |_| {}).await;
        assert_eq!(failed.retry, Some("check"));
        assert!(failed.error.unwrap().contains("检查更新失败"));
        server.mode.store(0, Ordering::Relaxed);
        let available = service.check(Ok(server.updater(&executable)), |_| {}).await;
        assert_eq!(available.phase, "available");
        assert_eq!(available.version.as_deref(), Some("9.0.0"));
        assert_eq!(available.notes.as_deref(), Some("更新验证说明"));
        assert_eq!(server.downloads.load(Ordering::Relaxed), 0);
        // 替换窗口订阅者，状态仍在同一个常驻服务中，托盘也能发现新版。
        let reopened = service.clone();
        assert_eq!(reopened.status().version, available.version);
        assert!(tray_text(&reopened.status()).contains("9.0.0"));
        assert!(service
            .install("8.0.0", |_| {})
            .await
            .unwrap_err()
            .contains("重新确认"));
        assert_eq!(server.downloads.load(Ordering::Relaxed), 0);
        server.mode.store(2, Ordering::Relaxed);
        let failed = service.install("9.0.0", |_| {}).await.unwrap();
        assert_eq!(failed.retry, Some("install"));
        assert!(failed.error.unwrap().contains("503"));
        server.mode.store(3, Ordering::Relaxed);
        let phases = std::sync::Mutex::new(Vec::new());
        let failed = service
            .install("9.0.0", |s| phases.lock().unwrap().push(s.phase))
            .await
            .unwrap();
        assert_eq!(failed.phase, "error");
        assert!(failed.error.as_deref().unwrap().contains("校验更新失败"));
        assert!(!phases.lock().unwrap().contains(&"installing"));
        assert_eq!(std::fs::read(&executable).unwrap(), b"existing app");
        // 同一个标准组件可下载并验证合法签名，也会在 install 入口再次拒绝篡改。
        server.mode.store(0, Ordering::Relaxed);
        let update = server.updater(&executable).check().await.unwrap().unwrap();
        let bytes = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(bytes, PAYLOAD);
        update.verify(&bytes).unwrap();
        assert!(update.install(b"tampered package").is_err());
        assert_eq!(std::fs::read(&executable).unwrap(), b"existing app");
        let portable = UpdateService::new("0.2.0".into(), false);
        portable
            .check(Ok(server.updater(&executable)), |_| {})
            .await;
        assert!(portable
            .install("9.0.0", |_| {})
            .await
            .unwrap_err()
            .contains("安装版"));
    });
}
