#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // If arguments are provided and not requesting the GUI, run in CLI mode
    if args.len() > 1 && args[1] != "--gui" && args[1] != "gui" && args[1] != "app" {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("Failed to initialize tokio runtime: {}", e);
                std::process::exit(1);
            }
        };

        let result = rt.block_on(ghost_compute_lib::cli::CliHandler::handle(args));
        match result {
            Ok(()) => std::process::exit(0),
            Err(err) => {
                eprintln!("Error: {}", err);
                std::process::exit(1);
            }
        }
    }

    let mut builder = env_logger::Builder::from_default_env();
    // mdns_sd v0.11 logs normal unregister packets at ERROR level via `error!("UnregisterResend from {}", ...)`
    builder.filter_module("mdns_sd::service_daemon", log::LevelFilter::Off);
    let _ = builder.try_init();
    ghost_compute_lib::run()
}
