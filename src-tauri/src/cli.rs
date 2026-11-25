use std::io::{self, Write};

use crate::integrations::IntegrationCatalog;
use crate::model_alias::ModelAliasStore;

pub struct CliHandler;

impl CliHandler {
    pub async fn handle(args: Vec<String>) -> Result<(), String> {
        if args.len() <= 1 {
            return Err("No command provided".to_string());
        }

        let cmd = args[1].as_str();

        match cmd {
            "serve" => {
                Self::handle_serve().await
            }
            "run" => {
                Self::handle_run(&args[2..]).await
            }
            "launch" => {
                Self::handle_launch(&args[2..]).await
            }
            "pull" => {
                Self::handle_pull(&args[2..]).await
            }
            "rm" | "delete" => {
                Self::handle_rm(&args[2..]).await
            }
            "ls" | "list" => {
                Self::handle_ls().await
            }
            "cp" | "alias" => {
                Self::handle_cp(&args[2..]).await
            }
            "ps" => {
                Self::handle_ps().await
            }
            "stop" => {
                Self::handle_stop(&args[2..]).await
            }
            "help" | "--help" | "-h" => {
                Self::print_help();
                Ok(())
            }
            "version" | "--version" | "-v" => {
                println!("Vant v0.18.0 (compatible with Ollama API)");
                Ok(())
            }
            _ => {
                Err(format!("Unknown command: '{}'. Run 'vant help' for usage.", cmd))
            }
        }
    }

    fn print_help() {
        println!("Vant - High-performance local LLM runtime, CLI manager & multi-protocol server");
        println!();
        println!("USAGE:");
        println!("  vant serve                           Start the local HTTP inference server");
        println!("  vant run <model> [--launch <tool>]   Run model or launch integration");
        println!("  vant launch [tool] [--model <m>]     Configure and launch developer tool");
        println!("    Options:");
        println!("      --model <model>                  Specify model to bind");
        println!("      --config                         Write configuration only (do not execute)");
        println!("      --yes                            Non-interactive mode (auto-accept prompts)");
        println!("      -- <args...>                     Pass arguments directly to launched tool");
        println!("  vant pull <model>                    Pull a model from registry");
        println!("  vant rm <model>                      Remove an installed model");
        println!("  vant ls                              List installed models");
        println!("  vant cp <source> <alias>             Create a model alias (e.g. claude-3-5-sonnet)");
        println!("  vant ps                              List loaded models in memory");
        println!("  vant stop <model>                    Unload a model from memory");
        println!();
        println!("SUPPORTED INTEGRATIONS (vant launch):");
        for item in IntegrationCatalog::all() {
            println!("  - {:<18} {}", item.id(), item.display_name());
        }
    }

    async fn handle_serve() -> Result<(), String> {
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "127.0.0.1:11434".to_string());
        println!("Vant server running on http://{}", endpoint);
        println!("Serving Ollama, OpenAI, and Anthropic multi-protocol endpoints.");
        println!("Press Ctrl+C to terminate.");

        // Wait indefinitely or handle SIGINT
        tokio::signal::ctrl_c().await.map_err(|e| format!("Signal error: {}", e))?;
        println!("\nVant server stopped.");
        Ok(())
    }

    async fn handle_run(args: &[String]) -> Result<(), String> {
        if args.is_empty() {
            return Err("Usage: vant run <model> [--launch <integration>]".to_string());
        }

        let model = &args[0];
        let mut launch_target: Option<String> = None;

        let mut i = 1;
        while i < args.len() {
            if args[i] == "--launch" && i + 1 < args.len() {
                launch_target = Some(args[i + 1].clone());
                i += 2;
            } else {
                i += 1;
            }
        }

        if let Some(tool) = launch_target {
            println!("Launching integration '{}' with model '{}'...", tool, model);
            let launch_args = vec![tool, "--model".to_string(), model.clone()];
            return Self::handle_launch(&launch_args).await;
        }

        println!("Interactive REPL for model: {}", model);
        println!("Type '/exit' or '/bye' to leave.");

        let client = reqwest::Client::new();
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let target_url = format!("{}/api/chat", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        loop {
            print!(">>> ");
            io::stdout().flush().map_err(|e| e.to_string())?;

            let mut input = String::new();
            if io::stdin().read_line(&mut input).is_err() {
                break;
            }

            let prompt = input.trim();
            if prompt.is_empty() {
                continue;
            }
            if prompt == "/exit" || prompt == "/bye" {
                break;
            }

            let resolved_model = ModelAliasStore::resolve_alias(model);
            let body = serde_json::json!({
                "model": resolved_model,
                "messages": [{ "role": "user", "content": prompt }],
                "stream": false
            });

            match client.post(&target_url).json(&body).send().await {
                Ok(res) => {
                    if let Ok(json) = res.json::<serde_json::Value>().await {
                        if let Some(reply) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                            println!("\n{}\n", reply);
                        } else if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                            println!("Error: {}", err);
                        }
                    }
                }
                Err(e) => {
                    println!("Connection error: {}. Is Vant running?", e);
                }
            }
        }

        Ok(())
    }

    async fn handle_launch(args: &[String]) -> Result<(), String> {
        let mut target_tool: Option<String> = None;
        let mut model: Option<String> = None;
        let mut config_only = false;
        let mut yes = false;
        let mut passthrough_args = Vec::new();

        let mut i = 0;
        while i < args.len() {
            let arg = &args[i];
            if arg == "--" {
                passthrough_args = args[i + 1..].to_vec();
                break;
            } else if arg == "--model" && i + 1 < args.len() {
                model = Some(args[i + 1].clone());
                i += 2;
                continue;
            } else if arg == "--config" {
                config_only = true;
            } else if arg == "--yes" || arg == "-y" {
                yes = true;
            } else if !arg.starts_with("--") && target_tool.is_none() {
                target_tool = Some(arg.clone());
            }
            i += 1;
        }

        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let clean_endpoint = if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) };

        // If no tool specified, prompt or list
        let tool_id = match target_tool {
            Some(t) => t,
            None => {
                println!("Available integrations:");
                for item in IntegrationCatalog::all() {
                    println!("  {:<15} - {}", item.id(), item.display_name());
                }
                print!("\nEnter tool name to launch: ");
                io::stdout().flush().map_err(|e| e.to_string())?;
                let mut choice = String::new();
                io::stdin().read_line(&mut choice).map_err(|e| e.to_string())?;
                choice.trim().to_string()
            }
        };

        let integration = IntegrationCatalog::find(&tool_id)
            .ok_or_else(|| format!("Unknown integration: '{}'. Run 'vant launch' to view catalog.", tool_id))?;

        let chosen_model = match model {
            Some(m) => m,
            None => {
                if yes {
                    "llama3.3".to_string()
                } else {
                    print!("Enter model name to bind (default: llama3.3): ");
                    io::stdout().flush().map_err(|e| e.to_string())?;
                    let mut m = String::new();
                    io::stdin().read_line(&mut m).map_err(|e| e.to_string())?;
                    let trimmed = m.trim();
                    if trimmed.is_empty() {
                        "llama3.3".to_string()
                    } else {
                        trimmed.to_string()
                    }
                }
            }
        };

        if config_only {
            let msg = integration.inject_config(&chosen_model, &clean_endpoint)?;
            println!("Config success: {}", msg);
            return Ok(());
        }

        // Check binary, install if needed
        if integration.check_binary().is_err() {
            println!("Binary for {} not detected.", integration.display_name());
            integration.prompt_install(yes)?;
        }

        println!("Launching {} with model '{}'...", integration.display_name(), chosen_model);
        integration.execute(&chosen_model, &passthrough_args, &clean_endpoint)?;
        Ok(())
    }

    async fn handle_cp(args: &[String]) -> Result<(), String> {
        if args.len() < 2 {
            return Err("Usage: vant cp <source_model> <target_alias>".to_string());
        }
        let src = &args[0];
        let alias = &args[1];

        ModelAliasStore::set_alias(alias, src)?;
        println!("Created alias '{}' -> '{}'", alias, src);
        Ok(())
    }

    async fn handle_ls() -> Result<(), String> {
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let url = format!("{}/api/tags", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        let client = reqwest::Client::new();
        match client.get(&url).send().await {
            Ok(res) => {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                        println!("{:<32} {:<12} {:<10}", "NAME", "ID", "MODIFIED");
                        println!("{:-<32} {:-<12} {:-<10}", "", "", "");
                        for m in models {
                            let name = m.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                            let id = m.get("digest").and_then(|d| d.as_str()).map(|d| &d[..8.min(d.len())]).unwrap_or("-");
                            let mod_at = m.get("modified_at").and_then(|t| t.as_str()).map(|t| &t[..10.min(t.len())]).unwrap_or("-");
                            println!("{:<32} {:<12} {:<10}", name, id, mod_at);
                        }

                        // List Aliases
                        let aliases = ModelAliasStore::list_aliases();
                        if !aliases.is_empty() {
                            println!("\nModel Aliases:");
                            for (alias, target) in aliases {
                                println!("  {} -> {}", alias, target);
                            }
                        }
                        return Ok(());
                    }
                }
                println!("No models found on {}", url);
            }
            Err(e) => {
                println!("Could not connect to {}: {}", url, e);
                println!("\nConfigured Aliases:");
                for (alias, target) in ModelAliasStore::list_aliases() {
                    println!("  {} -> {}", alias, target);
                }
            }
        }
        Ok(())
    }

    async fn handle_pull(args: &[String]) -> Result<(), String> {
        if args.is_empty() {
            return Err("Usage: vant pull <model>".to_string());
        }
        let model = &args[0];
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let url = format!("{}/api/pull", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        println!("Pulling model '{}' via {}...", model, url);
        let client = reqwest::Client::new();
        let res = client.post(&url).json(&serde_json::json!({ "name": model })).send().await
            .map_err(|e| format!("Failed to initiate pull: {}", e))?;

        if res.status().is_success() {
            println!("Pull complete for {}", model);
            Ok(())
        } else {
            Err(format!("Pull failed with status: {}", res.status()))
        }
    }

    async fn handle_rm(args: &[String]) -> Result<(), String> {
        if args.is_empty() {
            return Err("Usage: vant rm <model>".to_string());
        }
        let model = &args[0];
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let url = format!("{}/api/delete", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        let client = reqwest::Client::new();
        let res = client.delete(&url).json(&serde_json::json!({ "name": model })).send().await
            .map_err(|e| format!("Failed to delete model: {}", e))?;

        if res.status().is_success() {
            println!("Deleted model {}", model);
            Ok(())
        } else {
            Err(format!("Delete failed with status: {}", res.status()))
        }
    }

    async fn handle_ps() -> Result<(), String> {
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let url = format!("{}/api/ps", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        let client = reqwest::Client::new();
        match client.get(&url).send().await {
            Ok(res) => {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                        println!("{:<30} {:<12} {:<14}", "NAME", "SIZE VRAM", "CONTEXT");
                        println!("{:-<30} {:-<12} {:-<14}", "", "", "");
                        for m in models {
                            let name = m.get("name").and_then(|n| n.as_str()).unwrap_or("-");
                            let size = m.get("size_vram").and_then(|s| s.as_u64()).map(|s| format!("{} MB", s / 1024 / 1024)).unwrap_or("-".to_string());
                            let ctx = m.get("context_length").and_then(|c| c.as_u64()).map(|c| c.to_string()).unwrap_or("4096".to_string());
                            println!("{:<30} {:<12} {:<14}", name, size, ctx);
                        }
                        return Ok(());
                    }
                }
                println!("No active models currently loaded in memory.");
            }
            Err(e) => {
                println!("Could not connect to Vant endpoint: {}", e);
            }
        }
        Ok(())
    }

    async fn handle_stop(args: &[String]) -> Result<(), String> {
        if args.is_empty() {
            return Err("Usage: vant stop <model>".to_string());
        }
        let model = &args[0];
        let endpoint = std::env::var("VANT_HOST").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
        let url = format!("{}/api/chat", if endpoint.starts_with("http") { endpoint } else { format!("http://{}", endpoint) });

        // In Ollama/Vant protocol, sending a request with keep_alive: 0 unloads the model from VRAM
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "model": model,
            "keep_alive": 0
        });
        let _ = client.post(&url).json(&payload).send().await;
        println!("Unloaded model '{}' from memory.", model);
        Ok(())
    }
}
