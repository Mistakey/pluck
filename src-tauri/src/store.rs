//! Pluck 自己的本机数据：CPA 连接、最近一次成功获取的模型列表、各模式的模型字段快照。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::managed::{Mode, ModelInfo};
use crate::settings_file;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpaProfile {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshots {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpa: Option<Map<String, Value>>,
}

impl Snapshots {
    pub fn get(&self, mode: &Mode) -> Option<&Map<String, Value>> {
        match mode {
            Mode::Official => self.official.as_ref(),
            Mode::Cpa => self.cpa.as_ref(),
        }
    }
    pub fn set(&mut self, mode: &Mode, fields: Map<String, Value>) {
        match mode {
            Mode::Official => self.official = Some(fields),
            Mode::Cpa => self.cpa = Some(fields),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub cpa: Option<CpaProfile>,
    #[serde(default)]
    pub models: Vec<ModelInfo>,
    /// 最近一次成功获取列表的 Unix 秒。
    #[serde(default)]
    pub models_fetched_at: Option<u64>,
    #[serde(default)]
    pub snapshots: Snapshots,
}

pub struct Store {
    path: PathBuf,
}

pub struct LoadedState {
    pub state: State,
    revision: Option<String>,
}

impl Store {
    pub fn new(data_dir: &Path) -> Self {
        Store { path: data_dir.join("state.json") }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<LoadedState> {
        let loaded = settings_file::load(&self.path)?;
        let state: State = serde_json::from_value(Value::Object(loaded.doc)).map_err(|e| Error::Corrupt {
            path: self.path.clone(),
            detail: e.to_string(),
        })?;
        Ok(LoadedState { state, revision: loaded.revision })
    }

    pub fn save(&self, loaded: &mut LoadedState) -> Result<()> {
        loaded.state.version = 1;
        let Value::Object(doc) = serde_json::to_value(&loaded.state).expect("状态可序列化") else {
            unreachable!()
        };
        let bytes = settings_file::serialize(&doc, Default::default());
        settings_file::write_atomic(&self.path, &bytes, loaded.revision.as_deref())?;
        loaded.revision = Some(settings_file::revision_of(&bytes));
        Ok(())
    }
}
