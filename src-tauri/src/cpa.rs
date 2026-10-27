//! 从 CPA 获取模型列表。只接受结构完整、至少含一个模型的响应。

use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

use crate::error::{Error, Result};
use crate::managed::{normalize_url, ModelInfo};

pub fn validate_base_url(raw: &str) -> Result<String> {
    let url = normalize_url(raw);
    let parsed = url::Url::parse(&url).map_err(|_| Error::Refused(format!("CPA 地址无效：{url}")))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(Error::Refused(format!("CPA 地址需以 http:// 或 https:// 开头：{url}")));
    }
    Ok(url)
}

pub fn models_url(base_url: &str) -> String {
    format!("{}/v1/models", normalize_url(base_url))
}

/// 解析 `/v1/models` 响应，兼容 OpenAI 与 Anthropic 两种列表格式。
pub fn parse_models(body: &str) -> Result<Vec<ModelInfo>> {
    let v: Value = serde_json::from_str(body).map_err(|e| Error::Fetch(format!("响应不是有效 JSON：{e}")))?;
    let data = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| Error::Fetch("响应缺少 data 数组".into()))?;
    let mut out: Vec<ModelInfo> = Vec::new();
    let mut seen = HashSet::new();
    for item in data {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| Error::Fetch("列表中存在缺少 id 的模型".into()))?;
        if !seen.insert(id) {
            continue;
        }
        let display_name = item
            .get("display_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        out.push(ModelInfo { id: id.to_string(), display_name });
    }
    if out.is_empty() {
        return Err(Error::Fetch("CPA 返回了空列表".into()));
    }
    Ok(out)
}

pub fn fetch_models(base_url: &str, key: &str) -> Result<Vec<ModelInfo>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Fetch(e.to_string()))?;
    let resp = client
        .get(models_url(base_url))
        .bearer_auth(key)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .map_err(|e| Error::Fetch(format!("无法连接 CPA：{e}")))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| Error::Fetch(e.to_string()))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(200).collect();
        return Err(Error::Fetch(format!("HTTP {status}：{snippet}")));
    }
    parse_models(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn serve_once(status: &'static str, body: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(resp.as_bytes()).unwrap();
            req
        });
        (addr, h)
    }

    #[test]
    fn fetches_non_claude_models_with_auth() {
        let (addr, h) = serve_once(
            "200 OK",
            r#"{"object":"list","data":[{"id":"gpt-5.1-codex","object":"model"},{"id":"qwen3-coder-plus","display_name":"Qwen3 Coder"}]}"#,
        );
        let models = fetch_models(&format!("{addr}/"), "secret").unwrap();
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["gpt-5.1-codex", "qwen3-coder-plus"]);
        assert_eq!(models[1].display_name.as_deref(), Some("Qwen3 Coder"));
        let req = h.join().unwrap().to_ascii_lowercase();
        assert!(req.starts_with("get /v1/models "));
        assert!(req.contains("authorization: bearer secret"));
    }

    #[test]
    fn http_error_and_invalid_bodies_fail() {
        let (addr, _h) = serve_once("401 Unauthorized", r#"{"error":"bad key"}"#);
        assert!(matches!(fetch_models(&addr, "k"), Err(Error::Fetch(_))));
        assert!(parse_models("<html>").is_err());
        assert!(parse_models(r#"{"models":[]}"#).is_err());
        assert!(parse_models(r#"{"data":[]}"#).is_err());
        assert!(parse_models(r#"{"data":[{"name":"x"}]}"#).is_err());
    }

    #[test]
    fn unreachable_fails() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", l.local_addr().unwrap());
        drop(l);
        assert!(matches!(fetch_models(&addr, "k"), Err(Error::Fetch(_))));
    }

    #[test]
    fn url_validation() {
        assert_eq!(validate_base_url(" http://127.0.0.1:8317/ ").unwrap(), "http://127.0.0.1:8317");
        assert!(validate_base_url("127.0.0.1:8317").is_err());
        assert!(validate_base_url("ftp://x").is_err());
    }
}
