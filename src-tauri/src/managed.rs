//! Pluck 的管理范围：连接字段与模型字段。范围外的字段一律以实时文件为准。

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub const ENV_BASE_URL: &str = "ANTHROPIC_BASE_URL";
pub const ENV_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
pub const ENV_API_KEY: &str = "ANTHROPIC_API_KEY";
pub const ENV_SUBAGENT: &str = "CLAUDE_CODE_SUBAGENT_MODEL";

/// 连接字段：只在 CPA 模式下由 Pluck 写入，官方模式下不存在。
pub const CONNECTION_ENV_KEYS: &[&str] = &[ENV_BASE_URL, ENV_AUTH_TOKEN, ENV_API_KEY];

/// 顶层模型字段。
pub const MODEL_TOP_KEYS: &[&str] = &["model", "modelPicker"];

/// 别名及其显示信息。
pub const ALIASES: &[&str] = &["opus", "sonnet", "haiku"];

pub fn alias_env(alias: &str) -> String {
    format!("ANTHROPIC_DEFAULT_{}_MODEL", alias.to_ascii_uppercase())
}

/// env 中的模型字段：各模式各自保存，切换时不跨模式带过去。
pub fn model_env_keys() -> Vec<String> {
    let mut keys: Vec<String> = vec![
        "ANTHROPIC_MODEL".into(),
        "ANTHROPIC_DEFAULT_MODEL".into(),
        "ANTHROPIC_CUSTOM_MODEL_OPTION".into(),
        "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME".into(),
        "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION".into(),
        ENV_SUBAGENT.into(),
    ];
    for alias in ["OPUS", "SONNET", "HAIKU", "FABLE"] {
        for suffix in ["", "_NAME", "_DESCRIPTION", "_SUPPORTED_CAPABILITIES"] {
            keys.push(format!("ANTHROPIC_DEFAULT_{alias}_MODEL{suffix}"));
        }
    }
    keys
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Official,
    Cpa,
}

impl Mode {
    pub fn label(&self) -> &'static str {
        match self {
            Mode::Official => "官方",
            Mode::Cpa => "CPA",
        }
    }
}

/// 根据实时文件判断当前用户级连接。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detected {
    Official,
    Cpa,
    /// 连接字段存在但不是已保存的 CPA；Pluck 不覆盖它。
    Other { base_url: Option<String> },
}

pub fn normalize_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn env_of(doc: &Map<String, Value>) -> Option<&Map<String, Value>> {
    doc.get("env").and_then(Value::as_object)
}

pub fn env_str<'a>(doc: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    env_of(doc).and_then(|e| e.get(key)).and_then(Value::as_str)
}

pub fn detect(doc: &Map<String, Value>, cpa_base_url: Option<&str>) -> Detected {
    let env = env_of(doc);
    let has = |k: &str| env.map(|e| e.contains_key(k)).unwrap_or(false);
    if !CONNECTION_ENV_KEYS.iter().any(|k| has(k)) {
        return Detected::Official;
    }
    let base = env_str(doc, ENV_BASE_URL).map(str::to_string);
    if let (Some(b), Some(c)) = (base.as_deref(), cpa_base_url) {
        if normalize_url(b) == normalize_url(c) {
            return Detected::Cpa;
        }
    }
    Detected::Other { base_url: base }
}

/// 取出模型字段，结构为 `{ "model": .., "modelPicker": .., "env": { .. } }`。
pub fn extract_model_fields(doc: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for k in MODEL_TOP_KEYS {
        if let Some(v) = doc.get(*k) {
            out.insert((*k).into(), v.clone());
        }
    }
    let mut env_out = Map::new();
    if let Some(env) = env_of(doc) {
        for k in model_env_keys() {
            if let Some(v) = env.get(&k) {
                env_out.insert(k, v.clone());
            }
        }
    }
    if !env_out.is_empty() {
        out.insert("env".into(), Value::Object(env_out));
    }
    out
}

fn set_or_remove(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(v) => {
            map.insert(key.into(), v);
        }
        None => {
            map.shift_remove(key);
        }
    }
}

/// 以实时文件为底，替换全部管理字段：模型字段取自 `model_fields`，连接取自 `connection`。
/// 范围外字段保持原值与原顺序。
pub fn apply(
    live: &Map<String, Value>,
    model_fields: &Map<String, Value>,
    connection: Option<(&str, &str)>,
) -> Map<String, Value> {
    let mut doc = live.clone();
    for k in MODEL_TOP_KEYS {
        set_or_remove(&mut doc, k, model_fields.get(*k).cloned());
    }
    let mut env = doc.get("env").and_then(Value::as_object).cloned().unwrap_or_default();
    let src_env = model_fields.get("env").and_then(Value::as_object);
    for k in model_env_keys() {
        set_or_remove(&mut env, &k, src_env.and_then(|e| e.get(&k)).cloned());
    }
    match connection {
        Some((url, key)) => {
            env.insert(ENV_BASE_URL.into(), json!(url));
            env.insert(ENV_AUTH_TOKEN.into(), json!(key));
            env.shift_remove(ENV_API_KEY);
        }
        None => {
            for k in CONNECTION_ENV_KEYS {
                env.shift_remove(*k);
            }
        }
    }
    put_env(&mut doc, env);
    doc
}

/// 写回 env；管理字段移除后为空则整个删去，使往返后恢复原样。
fn put_env(doc: &mut Map<String, Value>, env: Map<String, Value>) {
    if env.is_empty() {
        doc.shift_remove("env");
    } else {
        doc.insert("env".into(), Value::Object(env));
    }
}

/// 界面中可编辑的 CPA 模型配置。None 表示“未指定”，沿用原生默认/继承规则。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub default_model: Option<String>,
    pub subagent_model: Option<String>,
    pub alias_opus: Option<String>,
    pub alias_sonnet: Option<String>,
    pub alias_haiku: Option<String>,
    /// 写入原生模型菜单的模型 ID；为空表示不配置菜单。
    pub picker_models: Vec<String>,
    /// 菜单只显示这些模型，隐藏内置的 Claude 系列选项。
    pub replace_built_in: bool,
}

/// 菜单行附带的显示信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: Option<String>,
}

fn non_empty(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn read_model_config(fields: &Map<String, Value>) -> ModelConfig {
    let env = fields.get("env").and_then(Value::as_object);
    let env_get = |k: &str| non_empty(env.and_then(|e| e.get(k)).and_then(Value::as_str));
    let picker = fields.get("modelPicker").and_then(Value::as_object);
    let picker_models = picker
        .and_then(|p| p.get("options"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r.get("model").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    ModelConfig {
        default_model: non_empty(fields.get("model").and_then(Value::as_str)),
        subagent_model: env_get(ENV_SUBAGENT),
        alias_opus: env_get(&alias_env("opus")),
        alias_sonnet: env_get(&alias_env("sonnet")),
        alias_haiku: env_get(&alias_env("haiku")),
        picker_models,
        replace_built_in: picker
            .and_then(|p| p.get("replaceBuiltInOptions"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

/// 把界面配置写入模型字段集合（同样适用于实时文件）。只改界面负责的键，
/// 其余模型字段（例如用户手写的 ANTHROPIC_MODEL）保持原样。
pub fn write_model_config(target: &mut Map<String, Value>, cfg: &ModelConfig, known: &[ModelInfo]) {
    set_or_remove(target, "model", non_empty(cfg.default_model.as_deref()).map(Value::String));

    let picker = if cfg.picker_models.is_empty() {
        None
    } else {
        let options: Vec<Value> = cfg
            .picker_models
            .iter()
            .map(|id| {
                let mut row = Map::new();
                row.insert("model".into(), json!(id));
                // 有独立显示名时说明行给出实际 ID，否则标题本身就是 ID。
                match known
                    .iter()
                    .find(|m| &m.id == id)
                    .and_then(|m| m.display_name.as_deref())
                    .filter(|n| n != id)
                {
                    Some(name) => {
                        row.insert("label".into(), json!(name));
                        row.insert("description".into(), json!(format!("CPA · {id}")));
                    }
                    None => {
                        row.insert("description".into(), json!("CPA 模型"));
                    }
                }
                Value::Object(row)
            })
            .collect();
        let mut p = Map::new();
        p.insert("options".into(), Value::Array(options));
        if cfg.replace_built_in {
            p.insert("replaceBuiltInOptions".into(), json!(true));
        }
        Some(Value::Object(p))
    };
    set_or_remove(target, "modelPicker", picker);

    let mut env = target.get("env").and_then(Value::as_object).cloned().unwrap_or_default();
    let pairs = [
        (ENV_SUBAGENT.to_string(), &cfg.subagent_model),
        (alias_env("opus"), &cfg.alias_opus),
        (alias_env("sonnet"), &cfg.alias_sonnet),
        (alias_env("haiku"), &cfg.alias_haiku),
    ];
    for (k, v) in pairs {
        set_or_remove(&mut env, &k, non_empty(v.as_deref()).map(Value::String));
    }
    put_env(target, env);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn detect_modes() {
        let cpa = Some("http://127.0.0.1:8317/");
        assert_eq!(detect(&obj(json!({"env": {"FOO": "1"}})), cpa), Detected::Official);
        assert_eq!(
            detect(&obj(json!({"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:8317", "ANTHROPIC_AUTH_TOKEN": "k"}})), cpa),
            Detected::Cpa
        );
        assert!(matches!(
            detect(&obj(json!({"env": {"ANTHROPIC_BASE_URL": "https://other.example"}})), cpa),
            Detected::Other { .. }
        ));
        assert!(matches!(detect(&obj(json!({"env": {"ANTHROPIC_API_KEY": "sk"}})), cpa), Detected::Other { .. }));
    }

    #[test]
    fn apply_keeps_unmanaged_fields_and_order() {
        let live = obj(json!({
            "permissions": {"allow": ["Bash(ls)"]},
            "model": "gpt-x",
            "hooks": {"Stop": []},
            "env": {"FOO": "1", "ANTHROPIC_BASE_URL": "http://cpa", "ANTHROPIC_AUTH_TOKEN": "k", "CLAUDE_CODE_SUBAGENT_MODEL": "gpt-y"},
            "laterField": {"a": 1}
        }));
        let out = apply(&live, &Map::new(), None);
        assert_eq!(
            Value::Object(out),
            json!({
                "permissions": {"allow": ["Bash(ls)"]},
                "hooks": {"Stop": []},
                "env": {"FOO": "1"},
                "laterField": {"a": 1}
            })
        );
    }

    #[test]
    fn apply_connection_and_model_fields() {
        let live = obj(json!({"theme": "dark"}));
        let fields = obj(json!({"model": "m1", "env": {"CLAUDE_CODE_SUBAGENT_MODEL": "m2"}}));
        let out = apply(&live, &fields, Some(("http://cpa", "key")));
        assert_eq!(
            Value::Object(out),
            json!({"theme": "dark", "model": "m1", "env": {"CLAUDE_CODE_SUBAGENT_MODEL": "m2", "ANTHROPIC_BASE_URL": "http://cpa", "ANTHROPIC_AUTH_TOKEN": "key"}})
        );
    }

    #[test]
    fn model_config_round_trip_and_unset() {
        let known = vec![ModelInfo { id: "gpt-5.1".into(), display_name: Some("GPT 5.1".into()) }];
        let mut fields = obj(json!({"env": {"ANTHROPIC_MODEL": "keep-me"}}));
        let cfg = ModelConfig {
            default_model: Some("gpt-5.1".into()),
            subagent_model: Some("qwen3-coder".into()),
            alias_sonnet: Some("qwen3-coder".into()),
            picker_models: vec!["gpt-5.1".into(), "qwen3-coder".into()],
            replace_built_in: true,
            ..Default::default()
        };
        write_model_config(&mut fields, &cfg, &known);
        assert_eq!(read_model_config(&fields), cfg);
        assert_eq!(fields["modelPicker"]["options"][0], json!({"model": "gpt-5.1", "label": "GPT 5.1", "description": "CPA · gpt-5.1"}));
        assert_eq!(fields["modelPicker"]["options"][1]["model"], json!("qwen3-coder"));

        write_model_config(&mut fields, &ModelConfig::default(), &known);
        assert_eq!(Value::Object(fields), json!({"env": {"ANTHROPIC_MODEL": "keep-me"}}));
    }
}
