//! 面向窗口与托盘的操作：状态、模式切换、CPA 连接、模型列表和模型配置。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cpa;
use crate::error::{Error, Result};
use crate::managed::{self, Detected, Mode, ModelConfig, ModelInfo};
use crate::settings_file;
use crate::store::{CpaProfile, Store};

/// 进程环境中会影响 CLI 连接或模型的变量（只报告名称）。
const WATCHED_PROCESS_ENV: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
];

pub const RELAUNCH_HINT: &str =
    "这是用户级默认配置：请重新打开 Claude Code CLI 以完整生效；项目级设置和启动参数仍按原生规则覆盖它。";

/// 按 Claude Code 的规则解析用户配置目录：CLAUDE_CONFIG_DIR，否则 ~/.claude。
pub fn resolve_claude_dir(env_dir: Option<String>, home: Option<PathBuf>) -> Option<PathBuf> {
    match env_dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(d) => Some(PathBuf::from(d)),
        None => home.map(|h| h.join(".claude")),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aliases {
    pub opus: Option<String>,
    pub sonnet: Option<String>,
    pub haiku: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// official / cpa / other / error
    pub mode: String,
    pub mode_label: String,
    pub error: Option<String>,
    pub other_base_url: Option<String>,
    pub config_dir: String,
    pub settings_path: String,
    pub settings_exists: bool,
    pub credentials_present: bool,
    pub cpa_configured: bool,
    pub cpa_base_url: Option<String>,
    pub cpa_key_hint: Option<String>,
    pub model: Option<String>,
    pub subagent_model: Option<String>,
    pub aliases: Aliases,
    pub picker_count: usize,
    pub process_env: Vec<String>,
    pub data_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub message: String,
    pub status: Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
    pub config: ModelConfig,
    /// live：CPA 正在使用，配置取自实时文件；saved：取自 Pluck 保存的 CPA 设置。
    pub source: String,
    /// 保存时需原样带回，用于识别期间的外部修改。
    pub revision: String,
    pub models: Vec<ModelInfo>,
    pub fetched_at: Option<u64>,
}

pub struct Service {
    claude_dir: PathBuf,
    store: Store,
    lock: Mutex<()>,
}

fn key_hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("****{tail}")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Service {
    pub fn new(claude_dir: PathBuf, data_dir: &Path) -> Self {
        Service { claude_dir, store: Store::new(data_dir), lock: Mutex::new(()) }
    }

    pub fn settings_path(&self) -> PathBuf {
        self.claude_dir.join("settings.json")
    }

    pub fn store_path(&self) -> &Path {
        self.store.path()
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> Status {
        let _g = self.guard();
        self.status_unlocked()
    }

    fn status_unlocked(&self) -> Status {
        let path = self.settings_path();
        let mut s = Status {
            mode: "error".into(),
            mode_label: "无法读取".into(),
            error: None,
            other_base_url: None,
            config_dir: self.claude_dir.display().to_string(),
            settings_path: path.display().to_string(),
            settings_exists: path.exists(),
            credentials_present: self.claude_dir.join(".credentials.json").exists(),
            cpa_configured: false,
            cpa_base_url: None,
            cpa_key_hint: None,
            model: None,
            subagent_model: None,
            aliases: Aliases { opus: None, sonnet: None, haiku: None },
            picker_count: 0,
            process_env: WATCHED_PROCESS_ENV
                .iter()
                .filter(|k| std::env::var_os(k).is_some())
                .map(|k| k.to_string())
                .collect(),
            data_path: self.store.path().display().to_string(),
        };
        let st = match self.store.load() {
            Ok(l) => l.state,
            Err(e) => {
                s.error = Some(e.to_string());
                return s;
            }
        };
        if let Some(p) = &st.cpa {
            s.cpa_configured = true;
            s.cpa_base_url = Some(p.base_url.clone());
            s.cpa_key_hint = Some(key_hint(&p.api_key));
        }
        let loaded = match settings_file::load(&path) {
            Ok(l) => l,
            Err(e) => {
                s.error = Some(e.to_string());
                return s;
            }
        };
        match managed::detect(&loaded.doc, st.cpa.as_ref().map(|p| p.base_url.as_str())) {
            Detected::Official => {
                s.mode = "official".into();
                s.mode_label = "官方".into();
            }
            Detected::Cpa => {
                s.mode = "cpa".into();
                s.mode_label = "CPA".into();
            }
            Detected::Other { base_url } => {
                s.mode = "other".into();
                s.mode_label = "其他连接".into();
                s.other_base_url = base_url;
            }
        }
        let cfg = managed::read_model_config(&managed::extract_model_fields(&loaded.doc));
        s.model = cfg.default_model;
        s.subagent_model = cfg.subagent_model;
        s.aliases = Aliases { opus: cfg.alias_opus, sonnet: cfg.alias_sonnet, haiku: cfg.alias_haiku };
        s.picker_count = cfg.picker_models.len();
        s
    }

    fn done(&self, message: impl Into<String>) -> OpResult {
        OpResult { message: message.into(), status: self.status_unlocked() }
    }

    /// 切换模式：先把当前模式实际保存的模型字段记入快照，再以实时文件为底应用目标模式。
    pub fn switch(&self, target: Mode) -> Result<OpResult> {
        let _g = self.guard();
        let mut st = self.store.load()?;
        let loaded = settings_file::load(&self.settings_path())?;
        let cpa_url = st.state.cpa.as_ref().map(|p| p.base_url.clone());
        let current = match managed::detect(&loaded.doc, cpa_url.as_deref()) {
            Detected::Official => Mode::Official,
            Detected::Cpa => Mode::Cpa,
            Detected::Other { base_url } => {
                return Err(Error::Refused(format!(
                    "当前用户配置的连接（{}）既不是官方也不是已保存的 CPA，Pluck 不覆盖它。可在窗口中把该地址保存为 CPA，或手动移除 settings.json 中的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY 后重试。",
                    base_url.unwrap_or_else(|| "仅含鉴权变量".into())
                )))
            }
        };
        if current == target {
            return Ok(self.done(format!("当前已是{}模式，未做修改。", target.label())));
        }
        let connection = match target {
            Mode::Cpa => {
                let p = st.state.cpa.clone().ok_or_else(|| {
                    Error::Refused("尚未保存 CPA 地址和 Key，请先在配置窗口中填写。".into())
                })?;
                Some((p.base_url, p.api_key))
            }
            Mode::Official => None,
        };

        st.state.snapshots.set(&current, managed::extract_model_fields(&loaded.doc));
        self.store.save(&mut st)?;

        let fields = st.state.snapshots.get(&target).cloned().unwrap_or_default();
        let doc = managed::apply(
            &loaded.doc,
            &fields,
            connection.as_ref().map(|(u, k)| (u.as_str(), k.as_str())),
        );
        settings_file::save(&loaded, &doc)?;
        Ok(self.done(format!("已切换到{}模式。{RELAUNCH_HINT}", target.label())))
    }

    /// 保存 CPA 连接。`api_key` 为空时沿用已保存的 Key。CPA 正在使用时同步更新实时文件。
    pub fn save_cpa(&self, base_url: &str, api_key: Option<&str>) -> Result<OpResult> {
        let _g = self.guard();
        let url = cpa::validate_base_url(base_url)?;
        let mut st = self.store.load()?;
        let key = match api_key.map(str::trim).filter(|k| !k.is_empty()) {
            Some(k) => k.to_string(),
            None => st
                .state
                .cpa
                .as_ref()
                .map(|p| p.api_key.clone())
                .ok_or_else(|| Error::Refused("请填写 CPA Key。".into()))?,
        };
        let loaded = settings_file::load(&self.settings_path())?;
        let old_url = st.state.cpa.as_ref().map(|p| p.base_url.clone());
        let live_is_cpa = managed::detect(&loaded.doc, old_url.as_deref()) == Detected::Cpa
            || managed::detect(&loaded.doc, Some(&url)) == Detected::Cpa;
        let url_changed = old_url.as_deref() != Some(url.as_str());
        if url_changed {
            // 列表属于原来的服务，换地址后需重新获取。
            st.state.models.clear();
            st.state.models_fetched_at = None;
        }
        st.state.cpa = Some(CpaProfile { base_url: url.clone(), api_key: key.clone() });
        if live_is_cpa {
            let doc = managed::apply(&loaded.doc, &managed::extract_model_fields(&loaded.doc), Some((&url, &key)));
            settings_file::save(&loaded, &doc)?;
            self.store.save(&mut st)?;
            return Ok(self.done(format!("CPA 连接已保存，并已更新当前用户配置。{RELAUNCH_HINT}")));
        }
        self.store.save(&mut st)?;
        Ok(self.done("CPA 连接已保存，切换到 CPA 时使用。"))
    }

    /// 获取模型列表。成功才替换本机列表；失败时原列表与配置不变。
    pub fn refresh_models(&self) -> Result<ModelView> {
        let profile = {
            let _g = self.guard();
            self.store
                .load()?
                .state
                .cpa
                .ok_or_else(|| Error::Refused("尚未保存 CPA 地址和 Key。".into()))?
        };
        let models = cpa::fetch_models(&profile.base_url, &profile.api_key)?;
        {
            let _g = self.guard();
            let mut st = self.store.load()?;
            if st.state.cpa.as_ref().map(|p| p.base_url.as_str()) != Some(profile.base_url.as_str()) {
                return Err(Error::Refused("获取期间 CPA 地址已更改，请重新获取。".into()));
            }
            st.state.models = models;
            st.state.models_fetched_at = Some(now_secs());
            self.store.save(&mut st)?;
        }
        self.model_view()
    }

    pub fn model_view(&self) -> Result<ModelView> {
        let _g = self.guard();
        let st = self.store.load()?.state;
        let loaded = settings_file::load(&self.settings_path())?;
        let live = managed::detect(&loaded.doc, st.cpa.as_ref().map(|p| p.base_url.as_str())) == Detected::Cpa;
        let (fields, source, revision) = if live {
            (
                managed::extract_model_fields(&loaded.doc),
                "live",
                loaded.revision.clone().unwrap_or_default(),
            )
        } else {
            (st.snapshots.cpa.clone().unwrap_or_default(), "saved", "saved".to_string())
        };
        Ok(ModelView {
            config: managed::read_model_config(&fields),
            source: source.into(),
            revision,
            models: st.models,
            fetched_at: st.models_fetched_at,
        })
    }

    /// 保存 CPA 模式的模型配置。CPA 正在使用时写入实时文件，否则写入 CPA 快照。
    pub fn save_model_config(&self, cfg: &ModelConfig, revision: &str) -> Result<OpResult> {
        let _g = self.guard();
        let mut st = self.store.load()?;
        let loaded = settings_file::load(&self.settings_path())?;
        let cpa_url = st.state.cpa.as_ref().map(|p| p.base_url.clone());
        let live = managed::detect(&loaded.doc, cpa_url.as_deref()) == Detected::Cpa;
        let expected = if live { loaded.revision.clone().unwrap_or_default() } else { "saved".into() };
        if revision != expected {
            return Err(Error::Conflict { path: self.settings_path() });
        }
        if live {
            let mut doc = loaded.doc.clone();
            managed::write_model_config(&mut doc, cfg, &st.state.models);
            settings_file::save(&loaded, &doc)?;
            Ok(self.done(format!("模型配置已写入当前用户配置。{RELAUNCH_HINT}")))
        } else {
            let mut fields: Map<String, Value> = st.state.snapshots.cpa.clone().unwrap_or_default();
            managed::write_model_config(&mut fields, cfg, &st.state.models);
            st.state.snapshots.cpa = Some(fields);
            self.store.save(&mut st)?;
            Ok(self.done("模型配置已保存，切换到 CPA 时生效。"))
        }
    }
}
