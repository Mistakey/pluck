//! 验证用命令行：用与桌面应用相同的服务层操作隔离目录，便于脚本化验证。
//! 不随应用发布。
//!
//!   cargo run --example pluckctl -- --claude-dir D --data-dir P <command>
//!   commands: status | save-cpa URL KEY | switch official|cpa | refresh | models
//!             | set-models JSON（ModelConfig，camelCase）

use pluck_lib::managed::{Mode, ModelConfig};
use pluck_lib::service::Service;
use std::path::PathBuf;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut take = |flag: &str| -> PathBuf {
        let i = args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("缺少 {flag}"));
        let v = args.remove(i + 1);
        args.remove(i);
        PathBuf::from(v)
    };
    let claude = take("--claude-dir");
    let data = take("--data-dir");
    let svc = Service::new(claude, &data);
    let out = match args.first().map(String::as_str) {
        Some("status") => Ok(serde_json::to_value(svc.status()).unwrap()),
        Some("save-cpa") => svc
            .save_cpa(&args[1], Some(&args[2]), &svc.status().connection_revision)
            .map(|r| serde_json::to_value(r).unwrap()),
        Some("save-connection") => {
            svc.save_cpa(&args[1], Some(&args[2]), &args[3]).map(|r| serde_json::to_value(r).unwrap())
        }
        Some("save-models") => {
            let cfg: ModelConfig = serde_json::from_str(&args[1]).expect("ModelConfig JSON");
            svc.save_model_config(&cfg, &args[2]).map(|r| serde_json::to_value(r).unwrap())
        }
        Some("switch") => {
            let mode = if args[1] == "cpa" { Mode::Cpa } else { Mode::Official };
            svc.switch(mode).map(|r| serde_json::to_value(r).unwrap())
        }
        Some("refresh") => svc.refresh_models().map(|r| serde_json::to_value(r).unwrap()),
        Some("models") => svc.model_view().map(|r| serde_json::to_value(r).unwrap()),
        Some("set-models") => {
            let cfg: ModelConfig = serde_json::from_str(&args[1]).expect("ModelConfig JSON");
            svc.model_view()
                .and_then(|v| svc.save_model_config(&cfg, &v.revision))
                .map(|r| serde_json::to_value(r).unwrap())
        }
        _ => {
            eprintln!("用法见文件头注释");
            std::process::exit(2);
        }
    };
    match out {
        Ok(v) => println!("{}", serde_json::to_string_pretty(&v).unwrap()),
        Err(e) => {
            println!("{}", serde_json::json!({ "error": e.to_string() }));
            std::process::exit(1);
        }
    }
}
