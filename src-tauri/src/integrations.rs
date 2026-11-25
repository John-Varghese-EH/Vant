use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::model_alias::get_user_home_dir;

pub trait Runner: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn description(&self) -> &str;
    fn check_binary(&self) -> Result<PathBuf, String>;
    fn prompt_install(&self, yes: bool) -> Result<(), String>;
    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String>;
}

pub trait Editor: Send + Sync {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String>;
}

pub trait RestorableIntegration: Send + Sync {
    fn backup_config(&self) -> Result<Option<PathBuf>, String>;
    fn restore_config(&self) -> Result<(), String>;
}

pub trait Integration: Runner + Editor + RestorableIntegration {}

// ---------------------------------------------------------
// Helper: Check if binary exists in PATH
// ---------------------------------------------------------
fn find_binary_in_path(bin_name: &str) -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(separator) {
            let p = PathBuf::from(dir).join(bin_name);
            if p.is_file() {
                return Some(p);
            }
            if cfg!(windows) {
                let p_exe = PathBuf::from(dir).join(format!("{}.exe", bin_name));
                if p_exe.is_file() {
                    return Some(p_exe);
                }
                let p_cmd = PathBuf::from(dir).join(format!("{}.cmd", bin_name));
                if p_cmd.is_file() {
                    return Some(p_cmd);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------
// 1. Claude Code (claude)
// ---------------------------------------------------------
pub struct ClaudeCodeIntegration;

impl Runner for ClaudeCodeIntegration {
    fn id(&self) -> &str {
        "claude"
    }

    fn display_name(&self) -> &str {
        "Claude Code CLI"
    }

    fn description(&self) -> &str {
        "Anthropic terminal coding agent with auto-onboarding bypass and Anthropic API redirect"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("claude").ok_or_else(|| "claude CLI binary not found in PATH".to_string())
    }

    fn prompt_install(&self, yes: bool) -> Result<(), String> {
        if !yes {
            println!("Claude Code is not installed. Run: npm install -g @anthropic-ai/claude-code");
        }
        let status = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" })
            .args(["install", "-g", "@anthropic-ai/claude-code"])
            .status()
            .map_err(|e| format!("Failed to run npm install: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("npm install failed for @anthropic-ai/claude-code".to_string())
        }
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;

        let mut cmd = Command::new(bin);
        cmd.env("ANTHROPIC_BASE_URL", endpoint)
            .env("ANTHROPIC_AUTH_TOKEN", "vant")
            .env("ANTHROPIC_API_KEY", "")
            .env("OLLAMA_HOST", endpoint);

        // If passthrough args already contain --model, avoid duplicate
        let has_model = passthrough_args.iter().any(|a| a == "--model");
        if !has_model {
            cmd.arg("--model").arg(model);
        }
        for arg in passthrough_args {
            cmd.arg(arg);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn Claude Code: {}", e))?;
        let status = child.wait().map_err(|e| format!("Claude Code execution failed: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Claude Code exited with status: {}", status))
        }
    }
}

impl Editor for ClaudeCodeIntegration {
    fn inject_config(&self, _model: &str, _endpoint: &str) -> Result<String, String> {
        // Onboarding bypass: set hasCompletedOnboarding to true in ~/.claude.json
        let config_path = get_user_home_dir().join(".claude.json");
        let mut json_val: serde_json::Value = if config_path.exists() {
            let data = fs::read_to_string(&config_path).unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = json_val.as_object_mut() {
            obj.insert("hasCompletedOnboarding".to_string(), serde_json::json!(true));
        }

        let updated = serde_json::to_string_pretty(&json_val)
            .map_err(|e| format!("Failed to format claude.json: {}", e))?;
        fs::write(&config_path, &updated)
            .map_err(|e| format!("Failed to write {}: {}", config_path.display(), e))?;

        Ok(format!("Updated {} (onboarding bypass applied)", config_path.display()))
    }
}

impl RestorableIntegration for ClaudeCodeIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let config_path = get_user_home_dir().join(".claude.json");
        if config_path.exists() {
            let bak = get_user_home_dir().join(".claude.json.vant.bak");
            fs::copy(&config_path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".claude.json.vant.bak");
        let config_path = get_user_home_dir().join(".claude.json");
        if bak.exists() {
            fs::copy(&bak, &config_path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for ClaudeCodeIntegration {}

// ---------------------------------------------------------
// 2. OpenAI Codex CLI (codex)
// ---------------------------------------------------------
pub struct CodexCliIntegration;

impl Runner for CodexCliIntegration {
    fn id(&self) -> &str {
        "codex"
    }

    fn display_name(&self) -> &str {
        "OpenAI Codex CLI"
    }

    fn description(&self) -> &str {
        "Terminal coding assistant using OpenAI Responses API format"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("codex").ok_or_else(|| "codex binary not found in PATH".to_string())
    }

    fn prompt_install(&self, yes: bool) -> Result<(), String> {
        if !yes {
            println!("Codex CLI not found. Please install via official release.");
        }
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.backup_config()?;
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;

        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("Failed to execute codex: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Codex CLI exited with status: {}", status))
        }
    }
}

impl Editor for CodexCliIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".codex");
        let _ = fs::create_dir_all(&dir);
        let config_path = dir.join("config.toml");

        let toml_content = format!(
            "model_provider = \"vant\"\nmodel = \"{}\"\n\n[model_providers.vant]\nname = \"Vant Local\"\nbase_url = \"{}/v1\"\nwire_api = \"responses\"\n",
            model, endpoint
        );

        fs::write(&config_path, &toml_content)
            .map_err(|e| format!("Failed to write {}: {}", config_path.display(), e))?;
        Ok(format!("Injected Vant provider to {}", config_path.display()))
    }
}

impl RestorableIntegration for CodexCliIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let config_path = get_user_home_dir().join(".codex").join("config.toml");
        if config_path.exists() {
            let bak = get_user_home_dir().join(".codex").join("config.toml.vant.bak");
            fs::copy(&config_path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".codex").join("config.toml.vant.bak");
        let config_path = get_user_home_dir().join(".codex").join("config.toml");
        if bak.exists() {
            fs::copy(&bak, &config_path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for CodexCliIntegration {}

// ---------------------------------------------------------
// 3. OpenCode (opencode)
// ---------------------------------------------------------
pub struct OpenCodeIntegration;

impl Runner for OpenCodeIntegration {
    fn id(&self) -> &str {
        "opencode"
    }

    fn display_name(&self) -> &str {
        "OpenCode AI"
    }

    fn description(&self) -> &str {
        "Open-source coding assistant configured with @ai-sdk/openai-compatible"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("opencode").ok_or_else(|| "opencode binary not found in PATH".to_string())
    }

    fn prompt_install(&self, yes: bool) -> Result<(), String> {
        if !yes {
            println!("OpenCode not found. Run: npm install -g opencode-ai");
        }
        let status = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" })
            .args(["install", "-g", "opencode-ai"])
            .status()
            .map_err(|e| format!("npm error: {}", e))?;
        if status.success() { Ok(()) } else { Err("Failed to install opencode-ai".to_string()) }
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.backup_config()?;
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;

        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("OpenCode execution failed: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("OpenCode exited with status: {}", status)) }
    }
}

impl Editor for OpenCodeIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".config").join("opencode");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("opencode.json");

        let payload = serde_json::json!({
            "$schema": "https://opencode.ai",
            "provider": {
                "vant": {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Vant",
                    "options": { "baseURL": format!("{}/v1", endpoint) },
                    "models": {
                        model: { "name": model }
                    }
                }
            },
            "model": format!("vant/{}", model)
        });

        fs::write(&path, serde_json::to_string_pretty(&payload).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(format!("Injected Vant provider to {}", path.display()))
    }
}

impl RestorableIntegration for OpenCodeIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let path = get_user_home_dir().join(".config").join("opencode").join("opencode.json");
        if path.exists() {
            let bak = get_user_home_dir().join(".config").join("opencode").join("opencode.json.vant.bak");
            fs::copy(&path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".config").join("opencode").join("opencode.json.vant.bak");
        let path = get_user_home_dir().join(".config").join("opencode").join("opencode.json");
        if bak.exists() {
            fs::copy(&bak, &path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for OpenCodeIntegration {}

// ---------------------------------------------------------
// 4. Factory Droid (droid)
// ---------------------------------------------------------
pub struct FactoryDroidIntegration;

impl Runner for FactoryDroidIntegration {
    fn id(&self) -> &str {
        "droid"
    }

    fn display_name(&self) -> &str {
        "Factory Droid"
    }

    fn description(&self) -> &str {
        "Factory.ai autonomous developer assistant"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("droid").ok_or_else(|| "droid binary not found in PATH".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install Factory Droid from https://factory.ai");
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;
        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("droid execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("droid exited with status: {}", status)) }
    }
}

impl Editor for FactoryDroidIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".factory");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.json");

        let mut config_val = if path.exists() {
            let data = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = config_val.as_object_mut() {
            obj.insert("provider".to_string(), serde_json::json!("vant"));
            obj.insert("model".to_string(), serde_json::json!(model));
            obj.insert("base_url".to_string(), serde_json::json!(format!("{}/v1", endpoint)));
            obj.insert("api_key".to_string(), serde_json::json!("vant"));
        }

        fs::write(&path, serde_json::to_string_pretty(&config_val).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(format!("Injected Vant provider to {}", path.display()))
    }
}

impl RestorableIntegration for FactoryDroidIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let path = get_user_home_dir().join(".factory").join("config.json");
        if path.exists() {
            let bak = get_user_home_dir().join(".factory").join("config.json.vant.bak");
            fs::copy(&path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".factory").join("config.json.vant.bak");
        let path = get_user_home_dir().join(".factory").join("config.json");
        if bak.exists() {
            fs::copy(&bak, &path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for FactoryDroidIntegration {}

// ---------------------------------------------------------
// 5. DeepSeek Harness (deepseek)
// ---------------------------------------------------------
pub struct DeepSeekHarnessIntegration;

impl Runner for DeepSeekHarnessIntegration {
    fn id(&self) -> &str {
        "deepseek"
    }

    fn display_name(&self) -> &str {
        "DeepSeek Harness"
    }

    fn description(&self) -> &str {
        "DeepSeek browser and command-line code execution harness"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("deepseek").ok_or_else(|| "deepseek binary not found in PATH".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install DeepSeek harness CLI or web agent.");
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;
        let mut cmd = Command::new(bin);
        cmd.env("DEEPSEEK_BASE_URL", format!("{}/v1", endpoint))
            .env("DEEPSEEK_API_KEY", "vant")
            .env("OPENAI_BASE_URL", format!("{}/v1", endpoint));
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("deepseek execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("deepseek exited with status: {}", status)) }
    }
}

impl Editor for DeepSeekHarnessIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".deepseek");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.json");

        let payload = serde_json::json!({
            "base_url": format!("{}/v1", endpoint),
            "api_key": "vant",
            "model": model
        });

        fs::write(&path, serde_json::to_string_pretty(&payload).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(format!("Injected Vant provider to {}", path.display()))
    }
}

impl RestorableIntegration for DeepSeekHarnessIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let path = get_user_home_dir().join(".deepseek").join("config.json");
        if path.exists() {
            let bak = get_user_home_dir().join(".deepseek").join("config.json.vant.bak");
            fs::copy(&path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".deepseek").join("config.json.vant.bak");
        let path = get_user_home_dir().join(".deepseek").join("config.json");
        if bak.exists() {
            fs::copy(&bak, &path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for DeepSeekHarnessIntegration {}

// ---------------------------------------------------------
// 6. Hermes Agent (hermes)
// ---------------------------------------------------------
pub struct HermesAgentIntegration;

impl Runner for HermesAgentIntegration {
    fn id(&self) -> &str {
        "hermes"
    }

    fn display_name(&self) -> &str {
        "Hermes Agent"
    }

    fn description(&self) -> &str {
        "Nous Research Hermes autonomous multi-step assistant"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("hermes").ok_or_else(|| "hermes binary not found in PATH".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install Hermes Agent via: pip install hermes-agent");
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;
        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("hermes execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("hermes exited with status: {}", status)) }
    }
}

impl Editor for HermesAgentIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".hermes");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.yaml");

        let yaml = format!(
            "model:\n  provider: custom\n  base_url: {}/v1\n  api_key: vant\n  default: {}\n",
            endpoint, model
        );

        fs::write(&path, yaml)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(format!("Injected Vant custom provider to {}", path.display()))
    }
}

impl RestorableIntegration for HermesAgentIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let path = get_user_home_dir().join(".hermes").join("config.yaml");
        if path.exists() {
            let bak = get_user_home_dir().join(".hermes").join("config.yaml.vant.bak");
            fs::copy(&path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".hermes").join("config.yaml.vant.bak");
        let path = get_user_home_dir().join(".hermes").join("config.yaml");
        if bak.exists() {
            fs::copy(&bak, &path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for HermesAgentIntegration {}

// ---------------------------------------------------------
// 7. OpenClaw (openclaw, alias clawdbot)
// ---------------------------------------------------------
pub struct OpenClawIntegration;

impl Runner for OpenClawIntegration {
    fn id(&self) -> &str {
        "openclaw"
    }

    fn display_name(&self) -> &str {
        "OpenClaw (clawdbot)"
    }

    fn description(&self) -> &str {
        "Autonomous AI developer gateway and terminal TUI interface"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("openclaw")
            .or_else(|| find_binary_in_path("clawdbot"))
            .ok_or_else(|| "openclaw binary not found in PATH".to_string())
    }

    fn prompt_install(&self, yes: bool) -> Result<(), String> {
        if !yes {
            println!("OpenClaw not found. Running: npm install -g openclaw");
        }
        let status = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" })
            .args(["install", "-g", "openclaw"])
            .status()
            .map_err(|e| format!("npm error: {}", e))?;
        if status.success() { Ok(()) } else { Err("Failed to install openclaw".to_string()) }
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        println!("Security Notice: OpenClaw connects local tools to your LLM. Running in Vant local sandbox mode.");
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;

        // Start gateway daemon in background if needed
        let _ = Command::new(&bin).arg("gateway").spawn();

        // Launch TUI
        let mut cmd = Command::new(bin);
        cmd.arg("tui");
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("openclaw execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("openclaw exited with status: {}", status)) }
    }
}

impl Editor for OpenClawIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let dir = get_user_home_dir().join(".openclaw");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("openclaw.json");

        let payload = serde_json::json!({
            "models": {
                "providers": {
                    "vant": {
                        "baseUrl": format!("{}/v1", endpoint),
                        "apiKey": "vant",
                        "api": "openai-completions",
                        "models": [
                            { "id": model, "name": model, "contextWindow": 65536 }
                        ]
                    }
                }
            },
            "agents": {
                "defaults": {
                    "model": { "primary": format!("vant/{}", model) }
                }
            }
        });

        fs::write(&path, serde_json::to_string_pretty(&payload).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(format!("Injected Vant provider to {}", path.display()))
    }
}

impl RestorableIntegration for OpenClawIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        let path = get_user_home_dir().join(".openclaw").join("openclaw.json");
        if path.exists() {
            let bak = get_user_home_dir().join(".openclaw").join("openclaw.json.vant.bak");
            fs::copy(&path, &bak).map_err(|e| format!("Backup failed: {}", e))?;
            Ok(Some(bak))
        } else {
            Ok(None)
        }
    }

    fn restore_config(&self) -> Result<(), String> {
        let bak = get_user_home_dir().join(".openclaw").join("openclaw.json.vant.bak");
        let path = get_user_home_dir().join(".openclaw").join("openclaw.json");
        if bak.exists() {
            fs::copy(&bak, &path).map_err(|e| format!("Restore failed: {}", e))?;
        }
        Ok(())
    }
}

impl Integration for OpenClawIntegration {}

// ---------------------------------------------------------
// 8. VS Code (vscode)
// ---------------------------------------------------------
pub struct VsCodeIntegration;

impl Runner for VsCodeIntegration {
    fn id(&self) -> &str {
        "vscode"
    }

    fn display_name(&self) -> &str {
        "Visual Studio Code"
    }

    fn description(&self) -> &str {
        "Configures VS Code user settings to target Vant Ollama & OpenAI endpoints"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("code").ok_or_else(|| "code CLI not found in PATH".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install Visual Studio Code from https://code.visualstudio.com");
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;
        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("code execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("code exited with status: {}", status)) }
    }
}

impl Editor for VsCodeIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let settings_path = if cfg!(target_os = "macos") {
            get_user_home_dir().join("Library/Application Support/Code/User/settings.json")
        } else if cfg!(windows) {
            if let Ok(appdata) = std::env::var("APPDATA") {
                PathBuf::from(appdata).join("Code/User/settings.json")
            } else {
                get_user_home_dir().join("AppData/Roaming/Code/User/settings.json")
            }
        } else {
            get_user_home_dir().join(".config/Code/User/settings.json")
        };

        if let Some(parent) = settings_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let mut config_val = if settings_path.exists() {
            let data = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = config_val.as_object_mut() {
            obj.insert("ollama.endpoint".to_string(), serde_json::json!(endpoint));
            obj.insert("chat.openai.baseUrl".to_string(), serde_json::json!(format!("{}/v1", endpoint)));
            obj.insert("chat.defaultModel".to_string(), serde_json::json!(model));
        }

        fs::write(&settings_path, serde_json::to_string_pretty(&config_val).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", settings_path.display(), e))?;
        Ok(format!("Injected Vant endpoints to VS Code settings at {}", settings_path.display()))
    }
}

impl RestorableIntegration for VsCodeIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        Ok(None)
    }
    fn restore_config(&self) -> Result<(), String> {
        Ok(())
    }
}

impl Integration for VsCodeIntegration {}

// ---------------------------------------------------------
// 9. Claude Desktop (claude-desktop)
// ---------------------------------------------------------
pub struct ClaudeDesktopIntegration;

impl Runner for ClaudeDesktopIntegration {
    fn id(&self) -> &str {
        "claude-desktop"
    }

    fn display_name(&self) -> &str {
        "Claude Desktop"
    }

    fn description(&self) -> &str {
        "Configures Claude Desktop app to consume Vant via Anthropic /v1/messages API"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        if cfg!(target_os = "macos") {
            let p = PathBuf::from("/Applications/Claude.app");
            if p.exists() { return Ok(p); }
        }
        find_binary_in_path("claude").ok_or_else(|| "Claude Desktop not found".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install Claude Desktop from https://claude.ai/download");
        Ok(())
    }

    fn execute(&self, model: &str, _passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        if cfg!(target_os = "macos") {
            let _ = Command::new("open").arg("-a").arg("Claude").status();
        }
        Ok(())
    }
}

impl Editor for ClaudeDesktopIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        let config_path = if cfg!(target_os = "macos") {
            get_user_home_dir().join("Library/Application Support/Claude/claude_desktop_config.json")
        } else if cfg!(windows) {
            if let Ok(appdata) = std::env::var("APPDATA") {
                PathBuf::from(appdata).join("Claude/claude_desktop_config.json")
            } else {
                get_user_home_dir().join("AppData/Roaming/Claude/claude_desktop_config.json")
            }
        } else {
            get_user_home_dir().join(".config/Claude/claude_desktop_config.json")
        };

        if let Some(parent) = config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let mut config_val = if config_path.exists() {
            let data = fs::read_to_string(&config_path).unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = config_val.as_object_mut() {
            obj.insert("anthropic_base_url".to_string(), serde_json::json!(format!("{}/v1", endpoint)));
            obj.insert("default_model".to_string(), serde_json::json!(model));
        }

        fs::write(&config_path, serde_json::to_string_pretty(&config_val).unwrap())
            .map_err(|e| format!("Failed to write {}: {}", config_path.display(), e))?;
        Ok(format!("Injected Vant Anthropic endpoint to Claude Desktop at {}", config_path.display()))
    }
}

impl RestorableIntegration for ClaudeDesktopIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        Ok(None)
    }
    fn restore_config(&self) -> Result<(), String> {
        Ok(())
    }
}

impl Integration for ClaudeDesktopIntegration {}

// ---------------------------------------------------------
// 10. ChatGPT Desktop (chatgpt-desktop / Codex Mode)
// ---------------------------------------------------------
pub struct ChatGptDesktopIntegration;

impl Runner for ChatGptDesktopIntegration {
    fn id(&self) -> &str {
        "chatgpt-desktop"
    }

    fn display_name(&self) -> &str {
        "ChatGPT Desktop (Codex Mode)"
    }

    fn description(&self) -> &str {
        "Configures ChatGPT Desktop in Codex mode via OpenAI Responses API"
    }

    fn check_binary(&self) -> Result<PathBuf, String> {
        find_binary_in_path("chatgpt").ok_or_else(|| "chatgpt binary not found in PATH".to_string())
    }

    fn prompt_install(&self, _yes: bool) -> Result<(), String> {
        println!("Please install ChatGPT Desktop from https://chatgpt.com");
        Ok(())
    }

    fn execute(&self, model: &str, passthrough_args: &[String], endpoint: &str) -> Result<(), String> {
        self.inject_config(model, endpoint)?;
        let bin = self.check_binary()?;
        let mut cmd = Command::new(bin);
        for arg in passthrough_args {
            cmd.arg(arg);
        }
        let status = cmd.status().map_err(|e| format!("chatgpt execution error: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("chatgpt exited with status: {}", status)) }
    }
}

impl Editor for ChatGptDesktopIntegration {
    fn inject_config(&self, model: &str, endpoint: &str) -> Result<String, String> {
        // Injects Codex profile configuration
        CodexCliIntegration.inject_config(model, endpoint)
    }
}

impl RestorableIntegration for ChatGptDesktopIntegration {
    fn backup_config(&self) -> Result<Option<PathBuf>, String> {
        CodexCliIntegration.backup_config()
    }
    fn restore_config(&self) -> Result<(), String> {
        CodexCliIntegration.restore_config()
    }
}

impl Integration for ChatGptDesktopIntegration {}

// ---------------------------------------------------------
// Registry & Dispatch
// ---------------------------------------------------------
pub struct IntegrationCatalog;

impl IntegrationCatalog {
    pub fn all() -> Vec<Box<dyn Integration>> {
        vec![
            Box::new(ClaudeCodeIntegration),
            Box::new(CodexCliIntegration),
            Box::new(OpenCodeIntegration),
            Box::new(FactoryDroidIntegration),
            Box::new(DeepSeekHarnessIntegration),
            Box::new(HermesAgentIntegration),
            Box::new(OpenClawIntegration),
            Box::new(VsCodeIntegration),
            Box::new(ClaudeDesktopIntegration),
            Box::new(ChatGptDesktopIntegration),
        ]
    }

    pub fn find(id: &str) -> Option<Box<dyn Integration>> {
        let clean = id.trim().to_lowercase();
        Self::all().into_iter().find(|i| {
            i.id() == clean || (clean == "clawdbot" && i.id() == "openclaw")
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IntegrationMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_installed: bool,
}

pub fn list_integrations_meta() -> Vec<IntegrationMetadata> {
    IntegrationCatalog::all()
        .into_iter()
        .map(|i| {
            let is_installed = i.check_binary().is_ok();
            IntegrationMetadata {
                id: i.id().to_string(),
                name: i.display_name().to_string(),
                description: i.description().to_string(),
                is_installed,
            }
        })
        .collect()
}
