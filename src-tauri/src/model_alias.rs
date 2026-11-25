use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

pub fn get_user_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return PathBuf::from(profile);
        }
    }
    PathBuf::from(".")
}

pub fn get_vant_config_dir() -> PathBuf {
    let vant_dir = get_user_home_dir().join(".vant");
    if !vant_dir.exists() {
        let _ = fs::create_dir_all(&vant_dir);
    }
    vant_dir
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelAliasStore {
    pub aliases: HashMap<String, String>,
}

lazy_static::lazy_static! {
    static ref GLOBAL_ALIASES: Arc<RwLock<ModelAliasStore>> = Arc::new(RwLock::new(ModelAliasStore::load()));
}

impl ModelAliasStore {
    fn file_path() -> PathBuf {
        get_vant_config_dir().join("aliases.json")
    }

    pub fn load() -> Self {
        let path = Self::file_path();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(store) = serde_json::from_str::<ModelAliasStore>(&content) {
                    return store;
                }
            }
        }
        // Provide standard default aliases
        let mut default_aliases = HashMap::new();
        default_aliases.insert("claude-3-5-sonnet-20241022".to_string(), "qwen2.5-coder:32b".to_string());
        default_aliases.insert("claude-3-5-sonnet".to_string(), "qwen2.5-coder:32b".to_string());
        default_aliases.insert("claude-3-sonnet".to_string(), "llama3.3".to_string());
        default_aliases.insert("gpt-4o".to_string(), "llama3.3".to_string());
        default_aliases.insert("gpt-4o-mini".to_string(), "llama3.2".to_string());
        default_aliases.insert("gpt-4-turbo".to_string(), "llama3.3".to_string());

        Self {
            aliases: default_aliases,
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::file_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let data = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize aliases: {}", e))?;
        fs::write(&path, data)
            .map_err(|e| format!("Failed to write aliases file: {}", e))?;
        Ok(())
    }

    pub fn resolve_alias(model: &str) -> String {
        if let Ok(guard) = GLOBAL_ALIASES.read() {
            if let Some(target) = guard.aliases.get(model) {
                return target.clone();
            }
        }
        model.to_string()
    }

    pub fn set_alias(alias: &str, target: &str) -> Result<(), String> {
        if let Ok(mut guard) = GLOBAL_ALIASES.write() {
            guard.aliases.insert(alias.to_string(), target.to_string());
            guard.save()?;
            Ok(())
        } else {
            Err("Failed to acquire lock on aliases store".to_string())
        }
    }

    pub fn remove_alias(alias: &str) -> Result<bool, String> {
        if let Ok(mut guard) = GLOBAL_ALIASES.write() {
            let removed = guard.aliases.remove(alias).is_some();
            if removed {
                guard.save()?;
            }
            Ok(removed)
        } else {
            Err("Failed to acquire lock on aliases store".to_string())
        }
    }

    pub fn list_aliases() -> HashMap<String, String> {
        if let Ok(guard) = GLOBAL_ALIASES.read() {
            guard.aliases.clone()
        } else {
            HashMap::new()
        }
    }
}
