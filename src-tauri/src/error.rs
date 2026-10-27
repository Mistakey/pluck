use std::path::PathBuf;

/// 面向用户的失败原因。消息里不包含 CPA Key。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("读取 {path} 失败：{source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("{path} 无法解析，已停止写入以免覆盖原有设置：{detail}")]
    Corrupt { path: PathBuf, detail: String },
    #[error("{path} 结构不适用，已停止写入：{detail}")]
    InvalidStructure { path: PathBuf, detail: String },
    #[error("写入 {path} 失败，原文件未改动：{detail}")]
    Write { path: PathBuf, detail: String },
    #[error("{path} 在操作期间被其他程序修改，已放弃写入并保留外部修改；请刷新后重试")]
    Conflict { path: PathBuf },
    #[error("{0}")]
    Refused(String),
    #[error("CPA 模型列表获取失败，已保留原列表：{0}")]
    Fetch(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
