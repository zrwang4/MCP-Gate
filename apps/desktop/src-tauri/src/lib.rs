mod core_supervisor;

use core_supervisor::{CoreRuntimeStatus, CoreSupervisor};
use tauri::{Manager, RunEvent, State};

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn core_runtime_status(state: State<'_, CoreSupervisor>) -> CoreRuntimeStatus {
    state.status()
}

#[tauri::command]
fn restart_core(state: State<'_, CoreSupervisor>) -> Result<CoreRuntimeStatus, String> {
    state.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let supervisor = CoreSupervisor::new();

            if let Err(error) = supervisor.ensure_started() {
                eprintln!("[desktop] Core auto-start failed: {error}");
            }

            app.manage(supervisor);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            core_runtime_status,
            restart_core
        ])
        .build(tauri::generate_context!())
        .expect("error while building MCP Gate");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            let supervisor = app_handle.state::<CoreSupervisor>();
            if let Err(error) = supervisor.stop_owned() {
                eprintln!("[desktop] Core shutdown failed: {error}");
            }
        }
    });
}
