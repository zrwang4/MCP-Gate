mod core_supervisor;

use core_supervisor::{CoreRuntimeStatus, CoreSupervisor};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

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

#[tauri::command]
fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("failed to read autostart state: {error}"))
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();

    if enabled {
        manager
            .enable()
            .map_err(|error| format!("failed to enable autostart: {error}"))?;
    } else {
        manager
            .disable()
            .map_err(|error| format!("failed to disable autostart: {error}"))?;
    }

    manager
        .is_enabled()
        .map_err(|error| format!("failed to verify autostart state: {error}"))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let supervisor = CoreSupervisor::new();

            if let Err(error) = supervisor.ensure_started() {
                eprintln!("[desktop] Core auto-start failed: {error}");
            }

            app.manage(supervisor);

            let open_item = MenuItem::with_id(app, "open", "打开 MCP Gate", true, None::<&str>)?;
            let restart_item =
                MenuItem::with_id(app, "restart-core", "重启 Core", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 MCP Gate", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &restart_item, &quit_item])?;

            TrayIconBuilder::with_id("mcp-gate-tray")
                .tooltip("MCP Gate")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "restart-core" => {
                        let supervisor = app.state::<CoreSupervisor>();
                        if let Err(error) = supervisor.restart() {
                            eprintln!("[desktop] Core restart from tray failed: {error}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            core_runtime_status,
            restart_core,
            autostart_enabled,
            set_autostart
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
