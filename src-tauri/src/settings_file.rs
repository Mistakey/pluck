//! Claude Code 用户级 settings.json 的读取与安全写入。
//!
//! 规则：解析失败或结构不适用时拒绝写入；写入先落临时文件，替换前复核
//! 文件内容是否仍是读取时的版本，被外部修改则放弃；替换失败时原文件保持不变。

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// 一次读取得到的文件内容和格式信息。
#[derive(Debug, Clone)]
pub struct Loaded {
    pub path: PathBuf,
    /// 读取时的内容摘要；文件不存在时为 None。
    pub revision: Option<String>,
    pub doc: Map<String, Value>,
    pub format: Format,
}

/// 写回时沿用的编码与换行格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Format {
    pub bom: bool,
    pub crlf: bool,
    pub trailing_newline: bool,
}

impl Default for Format {
    fn default() -> Self {
        Format { bom: false, crlf: false, trailing_newline: true }
    }
}

pub fn revision_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Read { path: path.to_path_buf(), source: e }),
    }
}

/// 当前文件版本，用于写入前复核。
pub fn current_revision(path: &Path) -> Result<Option<String>> {
    Ok(read_bytes(path)?.map(|b| revision_of(&b)))
}

/// 读取并校验 settings.json。不存在时视为空对象；存在但无法解析时报错，绝不当作空配置。
pub fn load(path: &Path) -> Result<Loaded> {
    let Some(bytes) = read_bytes(path)? else {
        return Ok(Loaded { path: path.to_path_buf(), revision: None, doc: Map::new(), format: Format::default() });
    };
    let revision = Some(revision_of(&bytes));
    let bom = bytes.starts_with(BOM);
    let body = if bom { &bytes[BOM.len()..] } else { &bytes[..] };
    let text = std::str::from_utf8(body).map_err(|_| Error::Corrupt {
        path: path.to_path_buf(),
        detail: "文件不是有效的 UTF-8 文本".into(),
    })?;
    let format = Format {
        bom,
        crlf: text.contains("\r\n"),
        trailing_newline: text.ends_with('\n'),
    };
    let doc = if text.trim().is_empty() {
        // 空白文件没有任何可丢失的设置，按空对象处理。
        Map::new()
    } else {
        let value: Value = serde_json::from_str(text).map_err(|e| Error::Corrupt {
            path: path.to_path_buf(),
            detail: e.to_string(),
        })?;
        match value {
            Value::Object(m) => m,
            other => {
                return Err(Error::InvalidStructure {
                    path: path.to_path_buf(),
                    detail: format!("根节点应为对象，实际为 {}", kind(&other)),
                })
            }
        }
    };
    if let Some(env) = doc.get("env") {
        if !env.is_object() {
            return Err(Error::InvalidStructure {
                path: path.to_path_buf(),
                detail: format!("env 应为对象，实际为 {}", kind(env)),
            });
        }
    }
    Ok(Loaded { path: path.to_path_buf(), revision, doc, format })
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "布尔值",
        Value::Number(_) => "数字",
        Value::String(_) => "字符串",
        Value::Array(_) => "数组",
        Value::Object(_) => "对象",
    }
}

pub fn serialize(doc: &Map<String, Value>, format: Format) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(doc).expect("JSON 对象总能序列化");
    if format.trailing_newline {
        text.push('\n');
    }
    if format.crlf {
        text = text.replace('\n', "\r\n");
    }
    let mut out = Vec::with_capacity(text.len() + 3);
    if format.bom {
        out.extend_from_slice(BOM);
    }
    out.extend_from_slice(text.as_bytes());
    out
}

/// 以原子替换写入。`expected` 为读取时的版本（文件原本不存在则为 None）；
/// 替换前文件版本不一致时放弃写入并返回 `Conflict`。
pub fn write_atomic(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<()> {
    let dir = path.parent().ok_or_else(|| Error::Write {
        path: path.to_path_buf(),
        detail: "无法确定所在目录".into(),
    })?;
    fs::create_dir_all(dir).map_err(|e| Error::Write { path: path.to_path_buf(), detail: e.to_string() })?;

    if let Ok(meta) = fs::metadata(path) {
        if meta.permissions().readonly() {
            return Err(Error::Write { path: path.to_path_buf(), detail: "文件为只读".into() });
        }
    }

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("settings.json");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{file_name}.pluck-{}-{nanos}.tmp", std::process::id()));

    let result = (|| {
        let mut f = fs::File::create(&tmp).map_err(|e| Error::Write { path: path.to_path_buf(), detail: e.to_string() })?;
        f.write_all(bytes).map_err(|e| Error::Write { path: path.to_path_buf(), detail: e.to_string() })?;
        f.sync_all().map_err(|e| Error::Write { path: path.to_path_buf(), detail: e.to_string() })?;
        drop(f);

        let now = current_revision(path)?;
        if now.as_deref() != expected {
            return Err(Error::Conflict { path: path.to_path_buf() });
        }
        fs::rename(&tmp, path).map_err(|e| Error::Write { path: path.to_path_buf(), detail: e.to_string() })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// 把修改后的文档写回，沿用原格式，并以读取时的版本做复核。
pub fn save(loaded: &Loaded, doc: &Map<String, Value>) -> Result<()> {
    write_atomic(&loaded.path, &serialize(doc, loaded.format), loaded.revision.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn missing_file_is_empty_object() {
        let d = tmp();
        let l = load(&d.path().join("settings.json")).unwrap();
        assert!(l.doc.is_empty());
        assert!(l.revision.is_none());
    }

    #[test]
    fn corrupt_json_is_error_not_empty() {
        let d = tmp();
        let p = d.path().join("settings.json");
        fs::write(&p, "{ \"model\": ").unwrap();
        assert!(matches!(load(&p), Err(Error::Corrupt { .. })));
    }

    #[test]
    fn non_object_root_and_env_rejected() {
        let d = tmp();
        let p = d.path().join("settings.json");
        fs::write(&p, "[1,2]").unwrap();
        assert!(matches!(load(&p), Err(Error::InvalidStructure { .. })));
        fs::write(&p, r#"{"env": ["A=1"]}"#).unwrap();
        assert!(matches!(load(&p), Err(Error::InvalidStructure { .. })));
    }

    #[test]
    fn bom_and_crlf_round_trip() {
        let d = tmp();
        let p = d.path().join("settings.json");
        let original = b"\xEF\xBB\xBF{\r\n  \"theme\": \"dark\"\r\n}\r\n";
        fs::write(&p, original).unwrap();
        let l = load(&p).unwrap();
        assert!(l.format.bom && l.format.crlf && l.format.trailing_newline);
        save(&l, &l.doc).unwrap();
        assert_eq!(fs::read(&p).unwrap(), original);
    }

    #[test]
    fn conflict_keeps_external_content() {
        let d = tmp();
        let p = d.path().join("settings.json");
        fs::write(&p, r#"{"theme":"dark"}"#).unwrap();
        let l = load(&p).unwrap();
        fs::write(&p, r#"{"theme":"light"}"#).unwrap();
        let mut doc = l.doc.clone();
        doc.insert("model".into(), json!("x"));
        assert!(matches!(save(&l, &doc), Err(Error::Conflict { .. })));
        assert_eq!(fs::read_to_string(&p).unwrap(), r#"{"theme":"light"}"#);
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1, "临时文件应被清理");
    }

    #[test]
    fn file_created_after_read_is_conflict() {
        let d = tmp();
        let p = d.path().join("settings.json");
        let l = load(&p).unwrap();
        fs::write(&p, r#"{"theme":"light"}"#).unwrap();
        assert!(matches!(save(&l, &Map::new()), Err(Error::Conflict { .. })));
    }

    #[test]
    fn readonly_file_untouched() {
        let d = tmp();
        let p = d.path().join("settings.json");
        fs::write(&p, r#"{"theme":"dark"}"#).unwrap();
        let mut perm = fs::metadata(&p).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&p, perm.clone()).unwrap();
        let l = load(&p).unwrap();
        let mut doc = l.doc.clone();
        doc.insert("model".into(), json!("x"));
        assert!(matches!(save(&l, &doc), Err(Error::Write { .. })));
        assert_eq!(fs::read_to_string(&p).unwrap(), r#"{"theme":"dark"}"#);
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        fs::set_permissions(&p, perm).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_untouched_on_windows() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = tmp();
        let p = d.path().join("settings.json");
        fs::write(&p, r#"{"theme":"dark"}"#).unwrap();
        let l = load(&p).unwrap();
        // 共享模式只允许读，模拟编辑器或其他进程独占占用。
        let _lock = fs::OpenOptions::new().read(true).share_mode(0x1).open(&p).unwrap();
        let mut doc = l.doc.clone();
        doc.insert("model".into(), json!("x"));
        assert!(matches!(save(&l, &doc), Err(Error::Write { .. })));
        drop(_lock);
        assert_eq!(fs::read_to_string(&p).unwrap(), r#"{"theme":"dark"}"#);
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1, "临时文件应被清理");
    }
}
