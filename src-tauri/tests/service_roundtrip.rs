//! 在临时用户目录中验证切换往返、字段保留、官方凭据不变与失败保护（A2、A5、A6）。

use pluck_lib::error::Error;
use pluck_lib::managed::{Mode, ModelConfig};
use pluck_lib::service::{resolve_claude_dir, Service};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

struct Env {
    _root: tempfile::TempDir,
    claude: PathBuf,
    svc: Service,
}

const CREDENTIALS: &str = r#"{"claudeAiOauth":{"accessToken":"official-token","refreshToken":"r"}}"#;

fn setup(initial: Value) -> Env {
    let root = tempfile::tempdir().unwrap();
    let claude = root.path().join(".claude");
    fs::create_dir_all(&claude).unwrap();
    fs::write(claude.join("settings.json"), serde_json::to_string_pretty(&initial).unwrap()).unwrap();
    fs::write(claude.join(".credentials.json"), CREDENTIALS).unwrap();
    let svc = Service::new(claude.clone(), &root.path().join("pluck-data"));
    Env { _root: root, claude, svc }
}

fn read(p: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
}

fn existing_settings() -> Value {
    json!({
        "permissions": {"allow": ["Bash(git status)"], "deny": []},
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo done"}]}]},
        "enabledPlugins": {"forge@local": true},
        "env": {"MY_UNKNOWN_VAR": "keep", "ENABLE_TOOL_SEARCH": "true"},
        "model": "opus",
        "theme": "dark"
    })
}

#[test]
fn round_trip_keeps_latest_cli_saved_models_and_other_settings() {
    let e = setup(existing_settings());
    let settings = e.claude.join("settings.json");

    e.svc.save_cpa("http://127.0.0.1:18317/", Some("cpa-secret")).unwrap();
    let r = e.svc.switch(Mode::Cpa).unwrap();
    assert_eq!(r.status.mode, "cpa");
    let v = read(&settings);
    assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:18317");
    assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "cpa-secret");
    assert!(v.get("model").is_none(), "官方模式的模型不应带到 CPA");

    // 窗口设置 CPA 默认模型 X 与菜单。
    let view = e.svc.model_view().unwrap();
    assert_eq!(view.source, "live");
    let cfg = ModelConfig {
        default_model: Some("gpt-5.1-codex".into()),
        subagent_model: Some("qwen3-coder-plus".into()),
        alias_haiku: Some("qwen3-coder-plus".into()),
        picker_models: vec!["gpt-5.1-codex".into(), "qwen3-coder-plus".into()],
        replace_built_in: true,
        ..Default::default()
    };
    e.svc.save_model_config(&cfg, &view.revision).unwrap();

    // 模拟 CLI 把默认模型保存为 Y，并在之后添加无关字段。
    let mut v = read(&settings);
    v["model"] = json!("qwen3-coder-plus");
    v["laterAddedField"] = json!({"x": 1});
    v["env"]["LATER_VAR"] = json!("1");
    fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();

    let r = e.svc.switch(Mode::Official).unwrap();
    assert_eq!(r.status.mode, "official");
    let v = read(&settings);
    for k in ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_SUBAGENT_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"] {
        assert!(v["env"].get(k).is_none(), "{k} 不应带回官方");
    }
    assert!(v.get("modelPicker").is_none());
    assert_eq!(v["model"], "opus", "官方模式恢复自己的最新已保存值");
    assert_eq!(v["laterAddedField"], json!({"x": 1}));
    assert_eq!(v["env"]["LATER_VAR"], "1");

    // 官方模式下 CLI 又保存了新模型。
    let mut v = read(&settings);
    v["model"] = json!("sonnet");
    fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();

    e.svc.switch(Mode::Cpa).unwrap();
    let v = read(&settings);
    assert_eq!(v["model"], "qwen3-coder-plus", "CPA 保留 CLI 保存的 Y");
    assert_eq!(v["env"]["CLAUDE_CODE_SUBAGENT_MODEL"], "qwen3-coder-plus");
    assert_eq!(v["modelPicker"]["options"][0]["model"], "gpt-5.1-codex");
    assert_eq!(v["modelPicker"]["replaceBuiltInOptions"], true);

    e.svc.switch(Mode::Official).unwrap();
    let v = read(&settings);
    assert_eq!(v["model"], "sonnet");

    // 未管理字段在整个往返中保持原值。
    let orig = existing_settings();
    for k in ["permissions", "hooks", "enabledPlugins", "theme"] {
        assert_eq!(v[k], orig[k], "{k} 被改动");
    }
    assert_eq!(v["env"]["MY_UNKNOWN_VAR"], "keep");
    assert_eq!(v["env"]["ENABLE_TOOL_SEARCH"], "true");
    assert_eq!(fs::read_to_string(e.claude.join(".credentials.json")).unwrap(), CREDENTIALS);

    // 重新创建服务（等同重开 Pluck）后读回。
    let svc2 = Service::new(e.claude.clone(), &e._root.path().join("pluck-data"));
    let s = svc2.status();
    assert_eq!(s.mode, "official");
    assert_eq!(s.cpa_base_url.as_deref(), Some("http://127.0.0.1:18317"));
    let saved = svc2.model_view().unwrap();
    assert_eq!(saved.source, "saved");
    assert_eq!(saved.config.default_model.as_deref(), Some("qwen3-coder-plus"));
}

#[test]
fn model_config_saved_while_official_applies_on_switch() {
    let e = setup(json!({"theme": "dark"}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    let view = e.svc.model_view().unwrap();
    assert_eq!(view.source, "saved");
    let cfg = ModelConfig { default_model: Some("deepseek-v3".into()), ..Default::default() };
    e.svc.save_model_config(&cfg, &view.revision).unwrap();
    assert!(read(&e.claude.join("settings.json")).get("model").is_none(), "官方模式下不改实时文件");
    e.svc.switch(Mode::Cpa).unwrap();
    assert_eq!(read(&e.claude.join("settings.json"))["model"], "deepseek-v3");
}

#[test]
fn unset_fields_are_removed_not_blanked() {
    let e = setup(json!({}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let rev = e.svc.model_view().unwrap().revision;
    let cfg = ModelConfig { subagent_model: Some("m".into()), alias_opus: Some("m".into()), ..Default::default() };
    e.svc.save_model_config(&cfg, &rev).unwrap();
    let rev = e.svc.model_view().unwrap().revision;
    e.svc.save_model_config(&ModelConfig::default(), &rev).unwrap();
    let v = read(&e.claude.join("settings.json"));
    assert!(v["env"].get("CLAUDE_CODE_SUBAGENT_MODEL").is_none());
    assert!(v["env"].get("ANTHROPIC_DEFAULT_OPUS_MODEL").is_none());
    assert!(v.get("model").is_none());
}

#[test]
fn stale_window_revision_is_rejected() {
    let e = setup(json!({}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let rev = e.svc.model_view().unwrap().revision;
    let p = e.claude.join("settings.json");
    let mut v = read(&p);
    v["model"] = json!("chosen-in-cli");
    fs::write(&p, v.to_string()).unwrap();
    let before = fs::read(&p).unwrap();
    let r = e.svc.save_model_config(&ModelConfig { default_model: Some("other".into()), ..Default::default() }, &rev);
    assert!(matches!(r, Err(Error::Conflict { .. })));
    assert_eq!(fs::read(&p).unwrap(), before);
}

#[test]
fn corrupt_or_invalid_settings_are_never_overwritten() {
    for bad in ["{ \"model\": \"x\", ", "[]", "{\"env\": \"A=1\"}", "\u{feff}{\"env\": [1]}"] {
        let e = setup(json!({}));
        let p = e.claude.join("settings.json");
        e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
        fs::write(&p, bad).unwrap();
        let r = e.svc.switch(Mode::Cpa);
        assert!(matches!(r, Err(Error::Corrupt { .. }) | Err(Error::InvalidStructure { .. })), "{bad}: {r:?}");
        assert_eq!(fs::read_to_string(&p).unwrap(), bad);
        assert_eq!(e.svc.status().mode, "error");
    }
}

#[test]
fn unknown_connection_is_refused() {
    let initial = json!({"env": {"ANTHROPIC_BASE_URL": "https://other-gateway.example", "ANTHROPIC_AUTH_TOKEN": "t"}});
    let e = setup(initial.clone());
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    let p = e.claude.join("settings.json");
    let before = fs::read(&p).unwrap();
    assert!(matches!(e.svc.switch(Mode::Official), Err(Error::Refused(_))));
    assert!(matches!(e.svc.switch(Mode::Cpa), Err(Error::Refused(_))));
    assert_eq!(fs::read(&p).unwrap(), before);
    assert_eq!(e.svc.status().mode, "other");
}

#[test]
fn readonly_settings_fail_and_keep_file() {
    let e = setup(existing_settings());
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    let p = e.claude.join("settings.json");
    let before = fs::read(&p).unwrap();
    let mut perm = fs::metadata(&p).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(&p, perm.clone()).unwrap();
    let r = e.svc.switch(Mode::Cpa);
    #[allow(clippy::permissions_set_readonly_false)]
    perm.set_readonly(false);
    fs::set_permissions(&p, perm).unwrap();
    assert!(matches!(r, Err(Error::Write { .. })), "{r:?}");
    assert_eq!(fs::read(&p).unwrap(), before);
    assert_eq!(e.svc.status().mode, "official");
}

#[test]
fn windows_crlf_bom_file_keeps_format_after_switch() {
    let e = setup(json!({}));
    let p = e.claude.join("settings.json");
    fs::write(&p, "\u{feff}{\r\n  \"theme\": \"dark\"\r\n}\r\n").unwrap();
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let bytes = fs::read(&p).unwrap();
    assert!(bytes.starts_with(b"\xEF\xBB\xBF"));
    let text = String::from_utf8(bytes[3..].to_vec()).unwrap();
    assert!(text.contains("\r\n") && !text.replace("\r\n", "").contains('\n'));
    e.svc.switch(Mode::Official).unwrap();
    assert_eq!(fs::read(&p).unwrap(), "\u{feff}{\r\n  \"theme\": \"dark\"\r\n}\r\n".as_bytes());
}

#[test]
fn changing_cpa_while_active_updates_connection_only() {
    let e = setup(json!({"theme": "dark"}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k1")).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    e.svc.save_cpa("http://127.0.0.1:18318", None).unwrap();
    let v = read(&e.claude.join("settings.json"));
    assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:18318");
    assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "k1");
    assert_eq!(e.svc.status().mode, "cpa");
}

#[test]
fn config_dir_resolution() {
    let home = PathBuf::from("C:/Users/u");
    assert_eq!(resolve_claude_dir(None, Some(home.clone())), Some(home.join(".claude")));
    assert_eq!(resolve_claude_dir(Some("  ".into()), Some(home.clone())), Some(home.join(".claude")));
    assert_eq!(resolve_claude_dir(Some("D:/cc".into()), Some(home)), Some(PathBuf::from("D:/cc")));
}

fn set_readonly(p: &Path, ro: bool) {
    let mut perm = fs::metadata(p).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perm.set_readonly(ro);
    fs::set_permissions(p, perm).unwrap();
}

/// 审查 S1：CPA 使用中更改地址，任一文件写入失败时两份数据保持一致，模式仍可切换。
#[test]
fn changing_active_cpa_is_consistent_when_either_file_fails() {
    let e = setup(json!({"theme": "dark"}));
    let data = e._root.path().join("pluck-data").join("state.json");
    let p = e.claude.join("settings.json");
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k1")).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    // 已有成功获取的模型列表与时间（直接写入本机数据，等同此前一次获取）。
    let mut state = read(&data);
    state["models"] = json!([{"id": "gpt-5.1-codex", "displayName": null}, {"id": "qwen3-coder-plus", "displayName": "Qwen3"}]);
    state["modelsFetchedAt"] = json!(123456);
    fs::write(&data, serde_json::to_string_pretty(&state).unwrap()).unwrap();
    let list_kept = |svc: &Service| {
        let v = svc.model_view().unwrap();
        v.models.len() == 2 && v.fetched_at == Some(123456)
    };
    assert!(list_kept(&e.svc));

    // 本机数据不可写。
    let settings_before = fs::read(&p).unwrap();
    set_readonly(&data, true);
    let r = e.svc.save_cpa("http://127.0.0.1:18318", None);
    set_readonly(&data, false);
    assert!(matches!(r, Err(Error::Write { .. })), "{r:?}");
    assert_eq!(fs::read(&p).unwrap(), settings_before, "用户配置不应先被改写");
    let s = e.svc.status();
    assert_eq!((s.mode.as_str(), s.cpa_base_url.as_deref()), ("cpa", Some("http://127.0.0.1:18317")));
    assert!(list_kept(&e.svc), "本机数据写入失败时模型列表保持");

    // 用户配置不可写：本机数据恢复为原地址与原列表。
    set_readonly(&p, true);
    let r = e.svc.save_cpa("http://127.0.0.1:18318", None);
    set_readonly(&p, false);
    assert!(matches!(r, Err(Error::Write { .. })), "{r:?}");
    assert_eq!(fs::read(&p).unwrap(), settings_before);
    let s = e.svc.status();
    assert_eq!((s.mode.as_str(), s.cpa_base_url.as_deref()), ("cpa", Some("http://127.0.0.1:18317")));
    assert!(list_kept(&e.svc), "用户配置写入失败时模型列表与获取时间恢复");

    // 失败后仍能正常切换。
    assert_eq!(e.svc.switch(Mode::Official).unwrap().status.mode, "official");
}

/// 审查 S2：官方模式下打开的旧草稿，在往返切换记录了 CLI 保存的 Y 之后不能覆盖 Y。
#[test]
fn stale_snapshot_draft_cannot_overwrite_cli_saved_model() {
    let e = setup(json!({"theme": "dark"}));
    let p = e.claude.join("settings.json");
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k")).unwrap();
    let v = e.svc.model_view().unwrap();
    e.svc.save_model_config(&ModelConfig { default_model: Some("model-X".into()), ..Default::default() }, &v.revision).unwrap();

    // 窗口在官方模式下读取（草稿基于 X）。
    let draft = e.svc.model_view().unwrap();
    assert_eq!(draft.source, "saved");

    // 托盘切到 CPA，CLI 保存 Y，托盘切回官方。
    e.svc.switch(Mode::Cpa).unwrap();
    let mut s = read(&p);
    s["model"] = json!("model-Y");
    fs::write(&p, s.to_string()).unwrap();
    e.svc.switch(Mode::Official).unwrap();

    // 旧草稿保存被拒绝，快照仍为 Y。
    let r = e.svc.save_model_config(
        &ModelConfig { default_model: Some("model-X".into()), subagent_model: Some("z".into()), ..Default::default() },
        &draft.revision,
    );
    assert!(matches!(r, Err(Error::Refused(_))), "{r:?}");
    let fresh = e.svc.model_view().unwrap();
    assert_eq!(fresh.config.default_model.as_deref(), Some("model-Y"));
    assert_ne!(fresh.revision, draft.revision);

    // 用最新版本保存可以成功；切回 CPA 后为 Y。
    e.svc.save_model_config(&ModelConfig { subagent_model: Some("z".into()), ..fresh.config.clone() }, &fresh.revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let s = read(&p);
    assert_eq!(s["model"], "model-Y");
    assert_eq!(s["env"]["CLAUDE_CODE_SUBAGENT_MODEL"], "z");
}
