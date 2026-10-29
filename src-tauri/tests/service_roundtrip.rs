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
        "env": {"MY_UNKNOWN_VAR": "keep", "ENABLE_TOOL_SEARCH": "true", "CLAUDE_CODE_AUTO_MODE_MODEL": "claude-sonnet-4-6"},
        "model": "opus",
        "theme": "dark"
    })
}

#[test]
fn round_trip_keeps_latest_cli_saved_models_and_other_settings() {
    let e = setup(existing_settings());
    let settings = e.claude.join("settings.json");

    e.svc.save_cpa("http://127.0.0.1:18317/", Some("cpa-secret"), &e.svc.status().connection_revision).unwrap();
    let r = e.svc.switch(Mode::Cpa).unwrap();
    assert_eq!(r.status.mode, "cpa");
    let v = read(&settings);
    assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "http://127.0.0.1:18317");
    assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "cpa-secret");
    assert!(v.get("model").is_none(), "官方模式的模型不应带到 CPA");
    assert!(v["env"].get("CLAUDE_CODE_AUTO_MODE_MODEL").is_none());

    // 窗口设置 CPA 默认模型 X 与菜单。
    let view = e.svc.model_view().unwrap();
    assert_eq!(view.source, "live");
    let cfg = ModelConfig {
        default_model: Some("gpt-5.1-codex".into()),
        subagent_model: Some("qwen3-coder-plus".into()),
        auto_mode_model: Some("deepseek-v3.2".into()),
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
    for k in
        ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_SUBAGENT_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]
    {
        assert!(v["env"].get(k).is_none(), "{k} 不应带回官方");
    }
    assert!(v.get("modelPicker").is_none());
    assert_eq!(v["model"], "opus", "官方模式恢复自己的最新已保存值");
    assert_eq!(v["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"], "claude-sonnet-4-6");
    assert_eq!(v["laterAddedField"], json!({"x": 1}));
    assert_eq!(v["env"]["LATER_VAR"], "1");

    // 官方模式下 CLI 又保存了新模型。
    let mut v = read(&settings);
    v["model"] = json!("sonnet");
    v["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"] = json!("claude-sonnet-5");
    fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();

    e.svc.switch(Mode::Cpa).unwrap();
    let v = read(&settings);
    assert_eq!(v["model"], "qwen3-coder-plus", "CPA 保留 CLI 保存的 Y");
    assert_eq!(v["env"]["CLAUDE_CODE_SUBAGENT_MODEL"], "qwen3-coder-plus");
    assert_eq!(v["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"], "deepseek-v3.2");
    assert_eq!(v["modelPicker"]["options"][0]["model"], "gpt-5.1-codex");
    assert_eq!(v["modelPicker"]["replaceBuiltInOptions"], true);

    e.svc.switch(Mode::Official).unwrap();
    let v = read(&settings);
    assert_eq!(v["model"], "sonnet");
    assert_eq!(v["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"], "claude-sonnet-5");

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
    assert_eq!(saved.config.auto_mode_model.as_deref(), Some("deepseek-v3.2"));
}

#[test]
fn model_config_saved_while_official_applies_on_switch() {
    let e = setup(json!({"theme": "dark"}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
    let view = e.svc.model_view().unwrap();
    assert_eq!(view.source, "saved");
    let cfg = ModelConfig { default_model: Some("deepseek-v3".into()), ..Default::default() };
    e.svc.save_model_config(&cfg, &view.revision).unwrap();
    assert!(read(&e.claude.join("settings.json")).get("model").is_none(), "官方模式下不改实时文件");
    e.svc.switch(Mode::Cpa).unwrap();
    assert_eq!(read(&e.claude.join("settings.json"))["model"], "deepseek-v3");
}

#[test]
fn stale_window_revision_is_rejected() {
    let e = setup(json!({}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
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
fn approval_only_edits_in_live_and_saved_fields_invalidate_drafts() {
    let e = setup(json!({}));
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let view = e.svc.model_view().unwrap();
    let p = e.claude.join("settings.json");
    let mut doc = read(&p);
    doc["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"] = json!("external/full-id");
    fs::write(&p, doc.to_string()).unwrap();
    assert!(matches!(e.svc.save_model_config(&view.config, &view.revision), Err(Error::Conflict { .. })));
    e.svc.switch(Mode::Official).unwrap();
    let saved = e.svc.model_view().unwrap();
    assert_eq!(saved.config.auto_mode_model.as_deref(), Some("external/full-id"));
    e.svc.save_model_config(
        &ModelConfig { auto_mode_model: Some("new/full-id".into()), ..saved.config.clone() },
        &saved.revision,
    ).unwrap();
    assert!(e.svc.save_model_config(&saved.config, &saved.revision).is_err());
    // Clearing is also a saved change, and must remove the native env field on switch.
    let fresh = e.svc.model_view().unwrap();
    e.svc.save_model_config(
        &ModelConfig { auto_mode_model: None, ..fresh.config }, &fresh.revision,
    ).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    assert!(read(&p)["env"].get("CLAUDE_CODE_AUTO_MODE_MODEL").is_none());
}

#[test]
fn corrupt_or_invalid_settings_are_never_overwritten() {
    let e = setup(json!({}));
    let p = e.claude.join("settings.json");
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
    let bad = "{ \"model\": \"x\", ";
    fs::write(&p, bad).unwrap();
    assert!(matches!(e.svc.switch(Mode::Cpa), Err(Error::Corrupt { .. })));
    assert_eq!(fs::read_to_string(&p).unwrap(), bad);
    assert_eq!(e.svc.status().mode, "error");
}

#[test]
fn unknown_connection_is_refused() {
    let initial = json!({"env": {"ANTHROPIC_BASE_URL": "https://other-gateway.example", "ANTHROPIC_AUTH_TOKEN": "t"}});
    let e = setup(initial.clone());
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
    let p = e.claude.join("settings.json");
    let before = fs::read(&p).unwrap();
    assert!(matches!(e.svc.switch(Mode::Official), Err(Error::Refused(_))));
    assert!(matches!(e.svc.switch(Mode::Cpa), Err(Error::Refused(_))));
    assert_eq!(fs::read(&p).unwrap(), before);
    assert_eq!(e.svc.status().mode, "other");
}

#[test]
fn windows_crlf_bom_file_keeps_format_after_switch() {
    let e = setup(json!({}));
    let p = e.claude.join("settings.json");
    fs::write(&p, "\u{feff}{\r\n  \"theme\": \"dark\"\r\n}\r\n").unwrap();
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
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
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k1"), &e.svc.status().connection_revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    e.svc.save_cpa("http://127.0.0.1:18318", None, &e.svc.status().connection_revision).unwrap();
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
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k1"), &e.svc.status().connection_revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    // 已有成功获取的模型列表与时间（直接写入本机数据，等同此前一次获取）。
    let mut state = read(&data);
    state["models"] =
        json!([{"id": "gpt-5.1-codex", "displayName": null}, {"id": "qwen3-coder-plus", "displayName": "Qwen3"}]);
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
    let r = e.svc.save_cpa("http://127.0.0.1:18318", None, &e.svc.status().connection_revision);
    set_readonly(&data, false);
    assert!(matches!(r, Err(Error::Write { .. })), "{r:?}");
    assert_eq!(fs::read(&p).unwrap(), settings_before, "用户配置不应先被改写");
    let s = e.svc.status();
    assert_eq!((s.mode.as_str(), s.cpa_base_url.as_deref()), ("cpa", Some("http://127.0.0.1:18317")));
    assert!(list_kept(&e.svc), "本机数据写入失败时模型列表保持");

    // 用户配置不可写：本机数据恢复为原地址与原列表。
    set_readonly(&p, true);
    let r = e.svc.save_cpa("http://127.0.0.1:18318", None, &e.svc.status().connection_revision);
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
    e.svc.save_cpa("http://127.0.0.1:18317", Some("k"), &e.svc.status().connection_revision).unwrap();
    let v = e.svc.model_view().unwrap();
    e.svc
        .save_model_config(&ModelConfig { default_model: Some("model-X".into()), ..Default::default() }, &v.revision)
        .unwrap();

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
    e.svc
        .save_model_config(&ModelConfig { subagent_model: Some("z".into()), ..fresh.config.clone() }, &fresh.revision)
        .unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let s = read(&p);
    assert_eq!(s["model"], "model-Y");
    assert_eq!(s["env"]["CLAUDE_CODE_SUBAGENT_MODEL"], "z");
}
#[test]
fn connection_revision_checks_key_and_ignores_unrelated_model_edits() {
    let e = setup(existing_settings());
    let first = e.svc.status().connection_revision;
    e.svc.save_cpa("http://127.0.0.1:18317", Some("old-1234"), &first).unwrap();
    let baseline = e.svc.status().connection_revision;
    let view = e.svc.model_view().unwrap();
    e.svc
        .save_model_config(&ModelConfig { default_model: Some("custom-id".into()), ..view.config }, &view.revision)
        .unwrap();
    assert_eq!(e.svc.status().connection_revision, baseline);
    e.svc.save_cpa("http://127.0.0.1:18317", Some("new-1234"), &baseline).unwrap();
    let before = fs::read(e.svc.store_path()).unwrap();
    let err = e.svc.save_cpa("http://127.0.0.1:18318", None, &baseline).unwrap_err();
    assert!(err.to_string().contains("别处更新"));
    assert_eq!(before, fs::read(e.svc.store_path()).unwrap());
}

#[test]
fn connection_write_reports_atomic_model_baselines_for_draft_rebase() {
    let e = setup(existing_settings());
    e.svc.save_cpa("http://127.0.0.1:18317", Some("key"), &e.svc.status().connection_revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let view = e.svc.model_view().unwrap();
    let r = e.svc.save_cpa("http://127.0.0.1:18318", None, &e.svc.status().connection_revision).unwrap();
    assert_eq!(r.before_model_revision, view.revision);
    assert_eq!(r.model_view.revision, view.revision);
    assert_eq!(serde_json::to_value(&r.model_view.config).unwrap(), serde_json::to_value(&view.config).unwrap());
    let mut doc = read(&e.claude.join("settings.json"));
    doc["model"] = json!("external-model");
    fs::write(e.claude.join("settings.json"), serde_json::to_string(&doc).unwrap()).unwrap();
    let newer = e.svc.save_cpa("http://127.0.0.1:18319", None, &e.svc.status().connection_revision).unwrap();
    assert_ne!(newer.before_model_revision, r.model_view.revision);
    assert_eq!(newer.model_view.config.default_model.as_deref(), Some("external-model"));
}
#[test]
fn fixed_old_version_sample_round_trips_without_replacing_key_or_snapshots() {
    let root = tempfile::tempdir().unwrap();
    let claude = root.path().join("claude");
    let data = root.path().join("data");
    fs::create_dir_all(&claude).unwrap();
    fs::create_dir_all(&data).unwrap();
    fs::write(
        claude.join("settings.json"),
        include_str!("../../docs/verification/fixtures/legacy-cpa/claude/settings.json"),
    )
    .unwrap();
    fs::write(
        claude.join(".credentials.json"),
        include_str!("../../docs/verification/fixtures/legacy-cpa/claude/.credentials.json"),
    )
    .unwrap();
    fs::write(data.join("state.json"), include_str!("../../docs/verification/fixtures/legacy-cpa/data/state.json"))
        .unwrap();
    let svc = Service::new(claude.clone(), &data);
    let before = read(svc.store_path());
    let credentials = fs::read(claude.join(".credentials.json")).unwrap();
    let view = svc.model_view().unwrap();
    assert_eq!(view.config.default_model.as_deref(), Some("legacy-outside-list"));
    assert_eq!(view.config.auto_mode_model, None, "旧快照和实时文件未指定审批模型");
    assert_eq!(view.models.len(), 2);
    let changed = ModelConfig {
        default_model: Some("model-b".into()),
        auto_mode_model: Some("model-a".into()),
        ..view.config
    };
    svc.save_model_config(&changed, &view.revision).unwrap();
    svc.save_cpa(&svc.status().cpa_base_url.unwrap(), None, &svc.status().connection_revision).unwrap();
    svc.switch(Mode::Official).unwrap();
    svc.switch(Mode::Cpa).unwrap();
    let after = read(svc.store_path());
    assert_eq!(before["cpa"], after["cpa"]);
    assert_eq!(before["models"], after["models"]);
    assert_eq!(before["snapshots"]["official"], after["snapshots"]["official"]);
    assert_eq!(credentials, fs::read(claude.join(".credentials.json")).unwrap());
    let settings = read(&claude.join("settings.json"));
    assert_eq!(settings["model"], "model-b");
    assert_eq!(settings["env"]["CLAUDE_CODE_AUTO_MODE_MODEL"], "model-a");
    assert_eq!(settings["env"]["KEEP_ME"], "preserved");
    assert_eq!(settings["theme"], "dark");
    assert_eq!(svc.model_view().unwrap().config.picker_models, vec!["model-a", "legacy-outside-list"]);
}

#[test]
fn model_fetch_rejects_a_late_result_after_key_changes() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    let e = setup(existing_settings());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    e.svc.save_cpa(&url, Some("first-key"), &e.svc.status().connection_revision).unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    std::thread::scope(|scope| {
        scope.spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
            let body = r#"{"data":[{"id":"old-key-model"}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let fetch = scope.spawn(|| e.svc.refresh_models());
        started_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        e.svc.save_cpa(&url, Some("second-key"), &e.svc.status().connection_revision).unwrap();
        release_tx.send(()).unwrap();
        assert!(fetch.join().unwrap().is_err());
    });
    assert!(e.svc.model_view().unwrap().models.is_empty());
}
#[test]
fn unrelated_settings_changes_do_not_stale_model_drafts_and_are_preserved() {
    let e = setup(existing_settings());
    e.svc.save_cpa("http://127.0.0.1:18317", Some("key"), &e.svc.status().connection_revision).unwrap();
    e.svc.switch(Mode::Cpa).unwrap();
    let view = e.svc.model_view().unwrap();
    let mut doc = read(&e.claude.join("settings.json"));
    doc["theme"] = json!("light");
    doc["env"]["NEW_UNRELATED"] = json!("keep-this");
    fs::write(e.claude.join("settings.json"), doc.to_string()).unwrap();
    assert_eq!(view.revision, e.svc.model_view().unwrap().revision);
    e.svc
        .save_model_config(&ModelConfig { default_model: Some("new-selection".into()), ..view.config }, &view.revision)
        .unwrap();
    let saved = read(&e.claude.join("settings.json"));
    assert_eq!(saved["theme"], "light");
    assert_eq!(saved["env"]["NEW_UNRELATED"], "keep-this");
    assert_eq!(saved["model"], "new-selection");
}
