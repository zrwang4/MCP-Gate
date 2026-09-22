mod core_supervisor;

use core_supervisor::{CoreRuntimeStatus, CoreSupervisor};
use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum UpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

#[tauri::command]
async fn check_for_update(app: AppHandle) -> Result<Option<UpdateMetadata>, String> {
    let update = app
        .updater()
        .map_err(|error| format!("failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("failed to check for updates: {error}"))?;

    Ok(update.map(|update| UpdateMetadata {
        version: update.version,
        current_version: update.current_version.to_string(),
        notes: update.body,
        pub_date: update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
async fn install_update(
    app: AppHandle,
    expected_version: String,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| format!("failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("failed to check for updates: {error}"))?
        .ok_or_else(|| "no update is currently available".to_string())?;

    if update.version != expected_version {
        return Err(format!(
            "available update changed from {expected_version} to {}; check again before installing",
            update.version
        ));
    }

    let mut started = false;

    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| format!("failed to install update: {error}"))?;

    app.restart();
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn management_token(state: State<'_, CoreSupervisor>) -> String {
    state.management_token()
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            let start_hidden = std::env::args().any(|arg| arg == "--hidden");

            let bundled_node = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|parent| parent.join("mcp-gate-node")))
                .filter(|path| path.exists());

            let bundled_core_entry = app
                .path()
                .resolve("core-runtime/dist/main.js", BaseDirectory::Resource)
                .ok()
                .filter(|path| path.exists());

            let supervisor = CoreSupervisor::new(
                bundled_node,
                bundled_core_entry,
            );

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
                .title("MCP")
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

            if start_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

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
            management_token,
            core_runtime_status,
            restart_core,
            autostart_enabled,
            set_autostart,
            check_for_update,
            install_update
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
