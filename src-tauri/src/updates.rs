//! 窗口之外的更新状态。检查仅取元数据；只有显式确认才下载和调用标准安装器。

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri_plugin_updater::{Update, Updater};

/// NSIS 会给构建目录中的 exe 也打上 bundle 标记，标记不能证明已经安装。
/// 当前用户安装版还必须在 NSIS 记录的安装位置运行。
pub fn is_current_user_installation() -> bool {
    #[cfg(windows)]
    {
        if !matches!(
            tauri::utils::platform::bundle_type(),
            Some(tauri::utils::config::BundleType::Nsis)
        ) {
            return false;
        }
        let Ok(key) = windows_registry::CURRENT_USER
            .options()
            .read()
            .access(0x0200)
            .open(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Pluck")
        else {
            return false;
        };
        let (Ok(location), Ok(binary), Ok(executable)) = (
            key.get_string("InstallLocation"),
            key.get_string("MainBinaryName"),
            std::env::current_exe(),
        ) else {
            return false;
        };
        matches_installation(&executable, &location, &binary)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(any(windows, test))]
fn matches_installation(executable: &std::path::Path, location: &str, binary: &str) -> bool {
    let registered = std::path::Path::new(location.trim_matches('"')).join(binary);
    match (executable.canonicalize(), registered.canonicalize()) {
        (Ok(actual), Ok(installed)) => actual == installed,
        _ => false,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub revision: u64,
    pub current_version: String,
    pub phase: &'static str,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub retry: Option<&'static str>,
    pub install_blocked: Option<String>,
}

struct Inner {
    status: UpdateStatus,
    candidate: Option<Update>,
}

pub struct UpdateService {
    inner: Mutex<Inner>,
}

impl UpdateService {
    pub fn new(current_version: String, installed: bool) -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: UpdateStatus {
                    revision: 0,
                    current_version,
                    phase: "idle",
                    version: None,
                    notes: None,
                    downloaded: 0,
                    total: None,
                    error: None,
                    retry: None,
                    install_blocked: (!installed).then(|| "请先安装当前用户安装版，再使用应用内更新。免安装或开发版本不能直接更新。".into()),
                },
                candidate: None,
            }),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .status
            .clone()
    }

    fn change(&self, f: impl FnOnce(&mut Inner), notify: &impl Fn(&UpdateStatus)) -> UpdateStatus {
        let status = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut inner);
            inner.status.revision += 1;
            inner.status.clone()
        };
        notify(&status);
        status
    }

    fn fail(
        &self,
        stage: &'static str,
        error: String,
        notify: &impl Fn(&UpdateStatus),
    ) -> UpdateStatus {
        self.change(
            |i| {
                i.status.phase = "error";
                i.status.error = Some(error);
                i.status.retry = Some(stage);
            },
            notify,
        )
    }

    pub async fn check(
        &self,
        updater: Result<Updater, String>,
        notify: impl Fn(&UpdateStatus),
    ) -> UpdateStatus {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(
                inner.status.phase,
                "checking" | "downloading" | "installing"
            ) {
                return inner.status.clone();
            }
            inner.status.phase = "checking";
            inner.status.error = None;
            inner.status.retry = None;
            inner.status.revision += 1;
        }
        notify(&self.status());
        let result = match updater {
            Ok(updater) => updater.check().await.map_err(|e| e.to_string()),
            Err(e) => Err(e),
        };
        match result {
            Ok(candidate) => self.change(
                |i| {
                    i.status.version = candidate.as_ref().map(|u| u.version.clone());
                    i.status.notes = candidate.as_ref().and_then(|u| u.body.clone());
                    i.status.phase = if candidate.is_some() {
                        "available"
                    } else {
                        "current"
                    };
                    i.status.downloaded = 0;
                    i.status.total = None;
                    i.candidate = candidate;
                },
                &notify,
            ),
            Err(e) => self.fail("check", format!("检查更新失败：{e}"), &notify),
        }
    }

    pub async fn install(
        &self,
        version: &str,
        notify: impl Fn(&UpdateStatus),
    ) -> Result<UpdateStatus, String> {
        let mut update = {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(i.status.phase, "checking" | "downloading" | "installing") {
                return Err("更新操作正在进行，请稍后重试。".into());
            }
            if let Some(reason) = &i.status.install_blocked {
                return Err(reason.clone());
            }
            let update = i
                .candidate
                .as_ref()
                .filter(|u| u.version == version)
                .ok_or("新版信息已变化，请重新确认更新。")?
                .clone();
            i.status.phase = "downloading";
            i.status.downloaded = 0;
            i.status.total = None;
            i.status.error = None;
            i.status.retry = None;
            i.status.revision += 1;
            update
        };
        notify(&self.status());
        // 元数据请求与包下载使用不同的超时；标准组件对下载和安装均校验签名。
        update.timeout = Some(Duration::from_secs(15 * 60));
        let bytes = match update
            .download(
                |size, total| {
                    self.change(
                        |i| {
                            i.status.downloaded += size as u64;
                            i.status.total = total;
                        },
                        &notify,
                    );
                },
                || {},
            )
            .await
        {
            Ok(bytes) => bytes,
            Err(e) => return Ok(self.fail("install", format!("下载或校验更新失败：{e}"), &notify)),
        };
        self.change(|i| i.status.phase = "installing", &notify);
        // Windows 标准 NSIS 更新器启动安装程序后退出，/R 在安装完成后重启。
        match update.install(bytes) {
            Ok(()) => Ok(self.status()),
            Err(e) => Ok(self.fail("install", format!("安装更新失败：{e}"), &notify)),
        }
    }
}

pub fn tray_text(status: &UpdateStatus) -> String {
    match status.phase {
        "checking" => "正在检查更新…".into(),
        "downloading" => "正在下载更新…".into(),
        "installing" => "正在安装更新…".into(),
        "error" => "更新失败 · 打开查看并重试".into(),
        _ => match &status.version {
            Some(v) => format!("发现新版 {v} · 打开查看"),
            None => format!("Pluck {} · 检查更新", status.current_version),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_path_rejects_a_portable_copy_even_with_an_nsis_bundle_marker() {
        let root = tempfile::tempdir().unwrap();
        let installed = root.path().join("installed");
        let portable = root.path().join("portable");
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::create_dir_all(&portable).unwrap();
        std::fs::write(installed.join("pluck.exe"), b"installed").unwrap();
        std::fs::write(portable.join("pluck.exe"), b"portable").unwrap();
        // Tauri's generated NSIS script quotes InstallLocation and records MainBinaryName.
        let location = format!("\"{}\"", installed.display());
        assert!(matches_installation(
            &installed.join("pluck.exe"),
            &location,
            "pluck.exe"
        ));
        assert!(!matches_installation(
            &portable.join("pluck.exe"),
            &location,
            "pluck.exe"
        ));
        assert!(!matches_installation(
            &installed.join("pluck.exe"),
            &location,
            "missing.exe"
        ));
    }
}
