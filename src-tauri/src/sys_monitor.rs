use serde::Serialize;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use sysinfo::System;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

lazy_static::lazy_static! {
    static ref SYS: Mutex<System> = Mutex::new(System::new_all());
}

static CACHED_ACCELERATORS: OnceLock<Vec<String>> = OnceLock::new();

#[derive(Serialize, Clone, Debug)]
pub struct SystemStats {
    pub cpu_usage_percent: f32,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub total_swap_mb: u64,
    pub used_swap_mb: u64,
    pub uptime_seconds: u64,
    pub os_name: String,
    pub host_name: String,
    pub gpu_name: Option<String>,
    pub gpu_vram_total_mb: Option<u64>,
    pub gpu_vram_used_mb: Option<u64>,
    pub gpu_temp_celsius: Option<u32>,
    pub gpu_utilization_percent: Option<u32>,
    pub accelerators: Vec<String>,
    pub is_remote: Option<bool>,
}

fn new_hidden_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

pub fn get_system_stats() -> SystemStats {
    let mut sys = SYS.lock().unwrap();

    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpus = sys.cpus();
    let cpu_cores = cpus.len();
    let cpu_brand = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Multi-Core Processor".to_string());

    let cpu_usage_percent = if !cpus.is_empty() {
        let sum: f32 = cpus.iter().map(|c| c.cpu_usage()).sum();
        sum / (cpus.len() as f32)
    } else {
        0.0
    };

    let gpu_info = probe_nvidia_gpu_metrics();
    let accelerators = CACHED_ACCELERATORS
        .get_or_init(|| detect_static_accelerators(gpu_info.0.as_deref()))
        .clone();

    SystemStats {
        cpu_usage_percent,
        cpu_brand,
        cpu_cores,
        total_memory_mb: sys.total_memory() / 1024 / 1024,
        used_memory_mb: sys.used_memory() / 1024 / 1024,
        total_swap_mb: sys.total_swap() / 1024 / 1024,
        used_swap_mb: sys.used_swap() / 1024 / 1024,
        uptime_seconds: System::uptime(),
        os_name: System::long_os_version().unwrap_or_else(|| "Unknown OS".to_string()),
        host_name: System::host_name().unwrap_or_else(|| "VantNode".to_string()),
        gpu_name: gpu_info.0,
        gpu_vram_total_mb: gpu_info.1,
        gpu_vram_used_mb: gpu_info.2,
        gpu_temp_celsius: gpu_info.3,
        gpu_utilization_percent: gpu_info.4,
        accelerators,
        is_remote: Some(false),
    }
}

fn probe_nvidia_gpu_metrics() -> (
    Option<String>,
    Option<u64>,
    Option<u64>,
    Option<u32>,
    Option<u32>,
) {
    if let Ok(output) = new_hidden_command("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.used,temperature.gpu,utilization.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                let name = parts.first().filter(|s| !s.is_empty()).map(|s| s.to_string());
                let total = parts.get(1).and_then(|s| s.parse::<u64>().ok());
                let used = parts.get(2).and_then(|s| s.parse::<u64>().ok());
                let temp = parts.get(3).and_then(|s| s.parse::<u32>().ok());
                let util = parts.get(4).and_then(|s| s.parse::<u32>().ok());
                return (name, total, used, temp, util);
            }
        }
    }
    (None, None, None, None, None)
}

fn detect_static_accelerators(nvidia_name: Option<&str>) -> Vec<String> {
    let mut found = Vec::new();
    if let Some(name) = nvidia_name {
        found.push(format!("CUDA: {}", name));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = new_hidden_command("wmic")
            .args(["path", "win32_VideoController", "get", "name"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines().skip(1) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Some(nv) = nvidia_name {
                        if trimmed.contains(nv) || nv.contains(trimmed) {
                            continue;
                        }
                    }
                    found.push(trimmed.to_string());
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = new_hidden_command("rocm-smi")
            .args(["--showproductname"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("Card series:") {
                        if let Some(val) = line.split(':').nth(1) {
                            found.push(format!("ROCm: {}", val.trim()));
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        found.push("Apple Metal Unified GPU".to_string());
    }

    found
}
